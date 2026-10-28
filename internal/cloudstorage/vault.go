package cloudstorage

// Vault keeps credentials separate from serializable connection metadata.
type Vault interface {
	Get(string) (Credentials, error)
	Set(string, Credentials) error
	Delete(string) error
}
