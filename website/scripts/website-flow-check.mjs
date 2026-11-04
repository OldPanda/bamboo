/** Verify the source card's rendered motion and reduced-motion fallback in Chrome. */
import assert from "node:assert/strict";

export async function checkFlow({ send, evaluate, origin, screenshot }) {
  const results = [];
  for (const width of [1280, 320]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 960,
      deviceScaleFactor: 1,
      mobile: false,
    });
    for (const language of ["en", "zh"]) {
      for (const mode of ["light", "dark"]) {
        await send("Emulation.setEmulatedMedia", {
          features: [
            { name: "prefers-color-scheme", value: mode },
            { name: "prefers-reduced-motion", value: "no-preference" },
          ],
        });
        const url = `${origin}/${language}/`;
        await send("Page.navigate", { url });
        let ready = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          ready = await evaluate(
            `location.href === ${JSON.stringify(url)} && document.readyState === 'complete' && document.querySelectorAll('.flow-dot').length === 4`,
          );
          if (ready) break;
          await new Promise((done) => setTimeout(done, 30));
        }
        assert(ready, "Source flow page did not load");
        await evaluate(
          `localStorage.removeItem('bamboo-site-theme'); delete document.documentElement.dataset.theme; document.querySelector('.source-art').scrollIntoView({block:'center', behavior:'instant'})`,
        );
        // Seek the real CSS animations to sample each route without timing races.
        const samples = [];
        for (const [time, active] of [
          [100, "flow-query"],
          [900, "flow-query"],
          [1800, "flow-local"],
          [4800, "flow-s3"],
          [7800, "flow-r2"],
        ]) {
          const sample = await evaluate(`(async () => {
            const dots = [...document.querySelectorAll('.flow-dot')];
            for (const dot of dots) {
              const animation = dot.getAnimations()[0];
              if (!animation) throw Error('Missing flow animation');
              animation.pause(); animation.currentTime = ${time};
            }
            await new Promise(requestAnimationFrame);
            return dots.map(dot => {
              const r = dot.getBoundingClientRect(), svg = dot.ownerSVGElement.getBoundingClientRect();
              return {name: [...dot.classList][1], opacity: Number(getComputedStyle(dot).opacity), x: r.x, y: r.y, width: r.width, height: r.height,
                contained: r.left >= svg.left && r.right <= svg.right && r.top >= svg.top && r.bottom <= svg.bottom};
            });
          })()`);
          const visible = sample.filter((dot) => dot.opacity > 0.5);
          assert.equal(visible.length, 1, "Only one pulse should be visible");
          assert.equal(
            visible[0].name,
            active,
            "Pulse should visit Query, local, S3, R2 in order",
          );
          assert(visible[0].contained, "Pulse must stay inside its actual SVG");
          assert(
            Math.abs(visible[0].width - visible[0].height) < 0.1,
            "Pulse must remain circular",
          );
          samples.push(visible[0]);
        }
        assert(
          samples[1].x > samples[0].x,
          "Query pulse must move toward Bamboo",
        );
        if (screenshot) await screenshot(`flow-${language}-${mode}-${width}`);
        await send("Emulation.setEmulatedMedia", {
          features: [
            { name: "prefers-color-scheme", value: mode },
            { name: "prefers-reduced-motion", value: "reduce" },
          ],
        });
        const reduced = await evaluate(
          `[...document.querySelectorAll('.flow-dot')].map(dot => ({name:getComputedStyle(dot).animationName, opacity:getComputedStyle(dot).opacity}))`,
        );
        assert.equal(reduced.length, 4);
        assert(
          reduced.every((dot) => dot.name === "none" && dot.opacity === "0"),
          "Reduced motion must preserve the static diagram without pulses",
        );
        results.push({ width, language, mode, samples, reduced });
      }
    }
  }
  return results;
}
