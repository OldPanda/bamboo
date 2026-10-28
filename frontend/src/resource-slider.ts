// Pointer gestures snap near useful whole-number stops. Typed values and
// keyboard increments remain exact and use the number field's validation.
/** Snap pointer values near useful stops while leaving distant values unchanged. */
export function snapBudget(
  value: number,
  min: number,
  max: number,
  stops: number[],
): number {
  const nearest = stops.reduce(
    (a, b) => (Math.abs(b - value) < Math.abs(a - value) ? b : a),
    min,
  );
  const neighbors = stops
    .filter((n) => n !== nearest)
    .map((n) => Math.abs(n - nearest));
  const threshold = Math.min(
    Math.max(1, (max - min) * 0.02),
    Math.min(...neighbors) / 4,
  );
  return Math.abs(value - nearest) <= threshold ? nearest : value;
}
/** Synchronize numeric input, slider and ticks; only pointer gestures snap. */
export function attachResourceSlider(
  number: HTMLInputElement,
  range: HTMLInputElement,
  ticks: HTMLElement,
  memory: boolean,
  changed: () => void = () => {},
) {
  let stops: number[] = [],
    dragging = false,
    bounds = "";
  function sync() {
    const min = Number(number.min),
      max = number.max === "" ? 16384 : Number(number.max);
    range.min = String(min);
    range.max = String(max);
    const key = `${min}:${max}`;
    if (key !== bounds) {
      bounds = key;
      const unit = memory ? 1024 : 1;
      const marks = [
        min,
        ...[1, 2, 3].map((i) => Math.round((max * i) / 4 / unit) * unit),
        max,
      ];
      const visible = [...new Set(marks)]
        .filter((n) => n >= min && n <= max)
        .sort((a, b) => a - b);
      stops = [...visible];
      if (memory) {
        for (let n = 128; n <= max; n *= 2) stops.push(n);
      } else {
        for (let n = 1; n <= max; n *= 2) stops.push(n);
      }
      stops = [...new Set(stops)]
        .filter((n) => n >= min && n <= max)
        .sort((a, b) => a - b);
      ticks.replaceChildren(
        ...visible.map((n, i) => {
          const label = document.createElement("span");
          label.textContent = String(n);
          label.style.left = `${((n - min) / Math.max(1, max - min)) * 100}%`;
          if (i === 0) label.className = "tick-start";
          else if (i === visible.length - 1) label.className = "tick-end";
          else if (i % 2 === 1) label.className = "tick-secondary";
          return label;
        }),
      );
    }
    if (number.value !== "" && number.validity.valid)
      range.value = number.value;
    range.style.setProperty(
      "--range-progress",
      `${((Number(range.value) - min) / Math.max(1, max - min)) * 100}%`,
    );
  }
  range.onpointerdown = () => {
    dragging = true;
  };
  range.onpointercancel = range.onblur = () => {
    dragging = false;
  };
  window.addEventListener("pointerup", () => {
    dragging = false;
  });
  range.onkeydown = () => {
    dragging = false;
  };
  range.oninput = () => {
    if (range.disabled) return;
    const value = Number(range.value);
    number.value = String(
      dragging
        ? snapBudget(value, Number(range.min), Number(range.max), stops)
        : value,
    );
    sync();
    changed();
  };
  number.oninput = () => {
    sync();
    changed();
  };
  return { sync };
}
