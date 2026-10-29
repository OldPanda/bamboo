package updater

import "errors"

func nativeError(code int) error {
	switch code {
	case 0:
		return nil
	case 1:
		return errors.New("updates are unavailable in this build")
	case 2:
		return errors.New("an update check is already in progress")
	default:
		return errors.New("could not start the updater")
	}
}
