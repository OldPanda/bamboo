#!/usr/bin/env python3
"""Verify the real native updater without windows, network checks or user settings."""

import json
import pathlib
import plistlib
import subprocess
import tempfile
import uuid

r = pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="bamboo-updater-smoke-") as tmp:
    root = pathlib.Path(tmp)
    app = root / "Bamboo Update Test.app"
    mac = app / "Contents/MacOS"
    mac.mkdir(parents=True)
    fw = app / "Contents/Frameworks"
    fw.mkdir()
    subprocess.run(
        [
            "ditto",
            str(r / "build/sparkle/Sparkle.framework"),
            str(fw / "Sparkle.framework"),
        ],
        check=True,
    )
    identifier = "local.bamboo.updater-smoke-" + uuid.uuid4().hex
    info = {
        "CFBundleIdentifier": identifier,
        "CFBundleName": "Bamboo Update Test",
        "CFBundleExecutable": "update-test",
        "CFBundlePackageType": "APPL",
        "CFBundleVersion": "0.1.0",
        "CFBundleShortVersionString": "0.1.0",
        "BambooReleaseVersion": "0.1.0",
        "SUFeedURL": "https://github.com/OldPanda/bamboo/releases/latest/download/appcast.xml",
        "SUPublicEDKey": (r / "assets/update-public-key.txt").read_text().strip(),
        "SUEnableAutomaticChecks": False,
        "SUAutomaticallyUpdate": False,
        "SUAllowsAutomaticUpdates": False,
        "SURequireSignedFeed": True,
        "SUVerifyUpdateBeforeExtraction": True,
    }
    (app / "Contents/Info.plist").write_bytes(plistlib.dumps(info))
    source = root / "smoke.m"
    # Compile the implementation in the harness translation unit so policy checks
    # inspect the same controller used by the native bridge, without a test API.
    source.write_text(
        (r / "internal/updater/native_darwin.m").read_text()
        + """#import <AppKit/AppKit.h>
#include <stdio.h>
#include <stdlib.h>
#include "native_darwin.h"
@interface SyntheticUpdate : NSObject <BambooUpdateItem>
@end
@implementation SyntheticUpdate
- (NSString *)displayVersionString { return @"0.2.0"; }
@end
int main(void) { @autoreleasepool {
 [NSApplication sharedApplication];
 [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
 [NSUserDefaults.standardUserDefaults removePersistentDomainForName:NSBundle.mainBundle.bundleIdentifier];
 // A stale preference must not enable unattended downloads or installation.
 [NSUserDefaults.standardUserDefaults setBool:YES forKey:@"SUAutomaticallyUpdate"];
 int started=bamboo_updater_start();
 char *status=bamboo_updater_status();
 printf("start=%d state=%s\\n",started,status); free(status);
 if(started) return 1;
 if([[(id)controller.updater valueForKey:@"allowsAutomaticUpdates"] boolValue]) return 5;
 if([[(id)controller.updater valueForKey:@"automaticallyDownloadsUpdates"] boolValue]) return 6;
 if(bamboo_updater_start()) return 2;
 if(bamboo_updater_automatic(1)) return 3;
 if([[(id)controller.updater valueForKey:@"automaticallyDownloadsUpdates"] boolValue]) return 7;
 status=bamboo_updater_status(); printf("enabled=%s\\n",status); free(status);
 if(bamboo_updater_automatic(0)) return 4;
 status=bamboo_updater_status(); printf("disabled=%s\\n",status); free(status);
 if(!reminder.supportsGentleScheduledUpdateReminders) return 8;
 SyntheticUpdate *item = [SyntheticUpdate new];
 if([reminder standardUserDriverShouldHandleShowingScheduledUpdate:item andInImmediateFocus:YES]) return 9;
 if([reminder standardUserDriverShouldHandleShowingScheduledUpdate:item andInImmediateFocus:NO]) return 10;
 [reminder standardUserDriverWillHandleShowingUpdate:NO forUpdate:item state:nil];
 status=bamboo_updater_status(); printf("reminder=%s\\n",status); free(status);
 [reminder standardUserDriverDidReceiveUserAttentionForUpdate:item];
 if(updateVersion != nil) return 11;
 [reminder standardUserDriverWillHandleShowingUpdate:NO forUpdate:item state:nil];
 [reminder standardUserDriverWillFinishUpdateSession];
 if(updateVersion != nil) return 12;
 [reminder standardUserDriverWillHandleShowingUpdate:NO forUpdate:item state:nil];
 [reminder standardUserDriverWillHandleShowingUpdate:YES forUpdate:item state:nil];
 if(updateVersion != nil) return 13;
 [NSUserDefaults.standardUserDefaults removePersistentDomainForName:NSBundle.mainBundle.bundleIdentifier];
 return 0;
} }
"""
    )
    subprocess.run(
        [
            "clang",
            "-fobjc-arc",
            "-fblocks",
            "-framework",
            "AppKit",
            "-framework",
            "Foundation",
            "-I",
            str(r / "internal/updater"),
            str(source),
            "-o",
            str(mac / "update-test"),
        ],
        check=True,
    )
    subprocess.run(
        ["codesign", "--force", "--sign", "-", str(app)],
        check=True,
        capture_output=True,
    )
    result = subprocess.run(
        [str(mac / "update-test")],
        check=True,
        capture_output=True,
        text=True,
        timeout=20,
    )
    lines = result.stdout.splitlines()
    assert lines[0].startswith("start=0 state=")
    initial = json.loads(lines[0].split("state=", 1)[1])
    enabled = json.loads(lines[1].split("=", 1)[1])
    disabled = json.loads(lines[2].split("=", 1)[1])
    assert initial["available"] is True and initial["automatic"] is False
    assert initial["canCheck"] is True and initial["version"] == "0.1.0"
    assert enabled["automatic"] is True and disabled["automatic"] is False
    reminder_state = json.loads(lines[3].split("=", 1)[1])
    assert initial["updateVersion"] == ""
    assert reminder_state["updateVersion"] == "0.2.0"
    print(
        "Native Sparkle startup, preferences and mandatory user-confirmed update policy passed."
    )
