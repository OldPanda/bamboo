// Derive only the public Ed25519 key; read the private seed from stdin, never argv.
import CryptoKit
import Foundation

let input = FileHandle.standardInput.readDataToEndOfFile()
guard let text = String(data: input, encoding: .utf8),
  let seed = Data(base64Encoded: text.trimmingCharacters(in: .whitespacesAndNewlines)),
  seed.count == 32
else { fatalError("Expected a base64-encoded 32-byte Sparkle private seed") }
let key = try Curve25519.Signing.PrivateKey(rawRepresentation: seed)
print(key.publicKey.rawRepresentation.base64EncodedString())
