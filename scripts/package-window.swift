// Inspect and quit only the exact packaged process started by the CI harness.
import AppKit
import CoreGraphics
import Foundation

guard ProcessInfo.processInfo.environment["GITHUB_ACTIONS"] == "true",
  CommandLine.arguments.count == 3,
  ["visible", "quit"].contains(CommandLine.arguments[2]),
  let pid = Int32(CommandLine.arguments[1]),
  let application = NSRunningApplication(processIdentifier: pid)
else { exit(1) }
if CommandLine.arguments[2] == "quit" {
  guard application.terminate() else { exit(1) }
} else {
  let windows =
    CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], 0)
    as? [[String: Any]] ?? []
  let visible = windows.contains {
    ($0[kCGWindowOwnerPID as String] as? Int32) == pid
      && ($0[kCGWindowLayer as String] as? Int) == 0
  }
  exit(visible ? 0 : 1)
}
