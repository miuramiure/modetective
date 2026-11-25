/** GM合言葉のハッシュと、トークン */
import {
  createHash,
  randomBytes,
  scrypt,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;

/** 合言葉は NFKC で整え、前後の空白を除いてから比べる（全角・半角の違いを吸収） */
export function normalizePass(pass: string): string {
  return pass.normalize("NFKC").trim();
}

/** 形式：scrypt$N$r$p$salt$hash（salt・hash は base64url） */
export function hashPasswordSync(
  pass: string,
  salt: Buffer = randomBytes(16),
): string {
  const key = scryptSync(normalizePass(pass), salt, KEYLEN, { N, r: R, p: P });
  return [
    "scrypt",
    N,
    R,
    P,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(
  pass: unknown,
  stored: string,
): Promise<boolean> {
  if (typeof pass !== "string" || pass.length > 200) return false;
  const [kind, n, r, p, saltB64, keyB64] = stored.split("$");
  if (kind !== "scrypt" || !saltB64 || !keyB64) return false;
  const want = Buffer.from(keyB64, "base64url");
  const got = await new Promise<Buffer>((resolve, reject) =>
    scrypt(
      normalizePass(pass),
      Buffer.from(saltB64, "base64url"),
      want.length,
      { N: Number(n), r: Number(r), p: Number(p) },
      (err, key) => (err ? reject(err) : resolve(key)),
    ),
  );
  return got.length === want.length && timingSafeEqual(got, want);
}

/** トークン（ブラウザに保存してもらう）。サーバーは hashToken したものだけを持つ */
export function newToken(): string {
  return randomBytes(24).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newId(): string {
  return randomBytes(9).toString("base64url");
}
