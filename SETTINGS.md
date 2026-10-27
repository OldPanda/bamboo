# Cloud connection settings

Open **Settings** at the bottom of the sidebar, or **Open data → Cloud storage → Manage connections**. The cloud connections list is separate from the workspace tree. Only implemented providers are offered; Cloudflare R2 and Amazon S3 are currently supported.

- **Add connection** tests and saves the selected provider configuration without opening a workspace.
- **Open** selects an existing workspace or opens the saved connection using Keychain credentials. Saved connections also appear under Open data → Cloud storage.
- **Edit** changes the display name or replaces credentials. All credential inputs are blank; leaving them all blank keeps the existing keys and any session token. Provider is fixed after creation. Endpoint/region/bucket/prefix are read-only while its workspace is open. Close that workspace before moving the connection to another location; changing location resets saved SQL.
- **Test** performs a read-only listing. Cancel operation or Escape cancels an in-flight Settings operation.
- **Delete** asks for confirmation, forgets metadata/SQL and Keychain credentials, and closes associated files. It never deletes cloud objects.

Closing a cloud workspace preserves its saved connection and SQL. Existing records without a closed flag are interpreted as open, maintaining prior restoration behavior. Adding the same location reuses its connection identity; edits cannot collide with another saved location.

Metadata writes are atomic. If writing settings fails, the store attempts to restore the prior credential entry; OS credential-store failures can also affect rollback. Invalid stored settings are reported rather than overwritten. Public connection metadata contains no credential fields; the form clears secrets when submitted or dismissed. Test failures retain prior valid configuration.

Validation uses real DuckDB/Parquet and a local S3 protocol fixture, synthetic credentials, actual native Settings controls, two-process restoration, failed saves, rotation, scope boundaries and race checks. Live Cloudflare/AWS bucket acceptance and native OS picker/Finder gestures remain manual. Native R2 fixtures run in a separate test-only build; production has no fixture transport hook.

## Previous Settings delivery

34 frontend scenarios and 29 native R2/Settings checks passed, including saved-but-closed connections across restart and re-adding an original location after editing a connection. Race checks, dependency scanning, type/static checks and production signature verification passed. Go combined coverage is 95.39%; frontend branch coverage is 95.78%. Actual screenshots and a self-contained mobile preview are in `artifacts/settings/`; exact binary hash and evidence are in its `delivery.json` and logs.

## AWS S3 addition

The same form now offers a provider selector. Amazon S3 asks for Region instead of a Cloudflare endpoint and supports optional Session Token credentials. Current provider-specific results and screenshots are in `artifacts/s3/`; current whole-repository coverage is in `artifacts/coverage/`.
