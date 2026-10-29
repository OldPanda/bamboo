// Sparkle is loaded only from the signed application's Frameworks directory.
// Objective-C protocols describe the small public API surface used dynamically;
// the Go test binary therefore has no runtime dependency on Sparkle.framework.
#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#include <string.h>
#include "native_darwin.h"

@protocol BambooSparkleUpdater
@property(nonatomic) BOOL automaticallyChecksForUpdates;
@property(nonatomic, readonly) BOOL canCheckForUpdates;
- (BOOL)startUpdater:(NSError **)error;
@end
@protocol BambooSparkleController
- (instancetype)initWithStartingUpdater:(BOOL)start updaterDelegate:(id)delegate userDriverDelegate:(id)driver;
@property(nonatomic, readonly) id<BambooSparkleUpdater> updater;
- (void)checkForUpdates:(id)sender;
@end

static id<BambooSparkleController> controller;
static BOOL started;
static NSString *updateVersion;

@protocol BambooUpdateItem
@property(nonatomic, readonly) NSString *displayVersionString;
@end

// Scheduled checks only publish a gentle reminder. Sparkle presents its normal
// confirmation UI when the user explicitly calls checkForUpdates.
@interface BambooUpdateReminder : NSObject
@end
@implementation BambooUpdateReminder
- (BOOL)supportsGentleScheduledUpdateReminders { return YES; }
- (BOOL)standardUserDriverShouldHandleShowingScheduledUpdate:(id)update andInImmediateFocus:(BOOL)focus {
    (void)update; (void)focus;
    return NO;
}
- (void)standardUserDriverWillHandleShowingUpdate:(BOOL)handle forUpdate:(id<BambooUpdateItem>)update state:(id)state {
    (void)state;
    updateVersion = handle ? nil : [update.displayVersionString copy];
}
- (void)standardUserDriverDidReceiveUserAttentionForUpdate:(id)update {
    (void)update;
    updateVersion = nil;
}
- (void)standardUserDriverWillFinishUpdateSession { updateVersion = nil; }
@end
static BambooUpdateReminder *reminder;

static void on_main(dispatch_block_t work) {
    if ([NSThread isMainThread]) { work(); }
    else { dispatch_sync(dispatch_get_main_queue(), work); }
}

int bamboo_updater_start(void) {
    __block int result = 0;
    on_main(^{
        @autoreleasepool {
            if (started) { return; }
            NSBundle *app = NSBundle.mainBundle;
            // A plain Go executable or test process must never start update checks.
            if (![app.bundlePath.pathExtension isEqualToString:@"app"] ||
                ![app objectForInfoDictionaryKey:@"SUPublicEDKey"] ||
                ![app objectForInfoDictionaryKey:@"SUFeedURL"]) {
                result = 1; return;
            }
            NSString *path = [app.privateFrameworksPath stringByAppendingPathComponent:@"Sparkle.framework"];
            NSBundle *framework = [NSBundle bundleWithPath:path];
            if (![framework loadAndReturnError:nil]) { result = 3; return; }
            Class cls = NSClassFromString(@"SPUStandardUpdaterController");
            if (!cls) { result = 3; return; }
            reminder = [BambooUpdateReminder new];
            controller = [(id<BambooSparkleController>)[cls alloc]
                initWithStartingUpdater:NO updaterDelegate:nil userDriverDelegate:reminder];
            NSError *error = nil;
            started = [controller.updater startUpdater:&error];
            if (!started) { controller = nil; result = 3; }
        }
    });
    return result;
}

char *bamboo_updater_status(void) {
    __block char *result = NULL;
    on_main(^{
        @autoreleasepool {
            NSString *version = [NSBundle.mainBundle objectForInfoDictionaryKey:@"BambooReleaseVersion"] ?: @"development";
            NSDictionary *status = @{@"version": version, @"available": started ? @YES : @NO,
                @"automatic": (started && controller.updater.automaticallyChecksForUpdates) ? @YES : @NO,
                @"canCheck": (started && controller.updater.canCheckForUpdates) ? @YES : @NO,
                @"updateVersion": updateVersion ?: @""};
            NSData *data = [NSJSONSerialization dataWithJSONObject:status options:0 error:nil];
            if (data) { result = strdup([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String); }
        }
    });
    return result;
}

int bamboo_updater_check(void) {
    __block int result = 0;
    on_main(^{
        if (!started) { result = 1; }
        else if (!controller.updater.canCheckForUpdates) { result = 2; }
        else { [controller checkForUpdates:nil]; }
    });
    return result;
}

int bamboo_updater_automatic(int enabled) {
    __block int result = 0;
    on_main(^{
        if (!started) { result = 1; }
        else { controller.updater.automaticallyChecksForUpdates = enabled != 0; }
    });
    return result;
}
