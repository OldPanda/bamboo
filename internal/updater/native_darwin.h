// Native calls marshal all Sparkle access onto the application's main thread.
#ifndef BAMBOO_UPDATER_H
#define BAMBOO_UPDATER_H
int bamboo_updater_start(void);
char *bamboo_updater_status(void);
int bamboo_updater_check(void);
int bamboo_updater_automatic(int enabled);
#endif
