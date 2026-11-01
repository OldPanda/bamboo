// Verify public release bytes without reading a private key or the Keychain.
import CryptoKit
import Foundation

guard CommandLine.arguments.count == 4,
  let publicBytes = Data(base64Encoded: CommandLine.arguments[1]),
  let signature = Data(base64Encoded: CommandLine.arguments[3])
else { exit(1) }
let publicKey = try Curve25519.Signing.PublicKey(rawRepresentation: publicBytes)
let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2]))
guard publicKey.isValidSignature(signature, for: data) else {
  FileHandle.standardError.write(
    Data("Release signature does not match the pinned public identity\n".utf8))
  exit(1)
}
