/**
 * A small, bundled list of well-known weak passwords, used by isCommonPassword.
 *
 * This is DATA, not logic: a curated subset of the passwords that top every
 * public breach list (rockyou, NCSC "top 100k", etc.). The check runs entirely
 * client-side, so we ship a compact list rather than calling an external API.
 * All entries are lowercase; isCommonPassword lowercases its input before lookup.
 */
const COMMON_PASSWORD_LIST = [
  "123456", "password", "12345678", "qwerty", "123456789", "12345", "1234", "111111",
  "1234567", "dragon", "123123", "baseball", "abc123", "football", "monkey", "letmein",
  "shadow", "master", "666666", "qwertyuiop", "123321", "mustang", "1234567890", "michael",
  "654321", "superman", "1qaz2wsx", "7777777", "121212", "000000", "qazwsx", "123qwe",
  "killer", "trustno1", "jordan", "jennifer", "zxcvbnm", "asdfgh", "hunter", "buster",
  "soccer", "harley", "batman", "andrew", "tigger", "sunshine", "iloveyou", "2000",
  "charlie", "robert", "thomas", "hockey", "ranger", "daniel", "starwars", "klaster",
  "112233", "george", "computer", "michelle", "jessica", "pepper", "1111", "zxcvbn",
  "555555", "11111111", "131313", "freedom", "777777", "pass", "maggie", "159753",
  "aaaaaa", "ginger", "princess", "joshua", "cheese", "amanda", "summer", "love",
  "ashley", "nicole", "chelsea", "biteme", "matthew", "access", "yankees", "987654321",
  "dallas", "austin", "thunder", "taylor", "matrix", "william", "corvette", "hello",
  "martin", "heather", "secret", "merlin", "diamond", "1234qwer", "gfhjkm", "hammer",
  "silver", "222222", "88888888", "anthony", "justin", "test", "bailey", "q1w2e3r4t5",
  "patrick", "internet", "scooter", "orange", "11111", "golfer", "cookie", "richard",
  "samantha", "bigdog", "guitar", "jackson", "whatever", "mickey", "chicken", "sparky",
  "snoopy", "maverick", "phoenix", "camaro", "sexy", "peanut", "morgan", "welcome",
  "falcon", "cowboy", "ferrari", "samsung", "andrea", "smokey", "steelers", "joseph",
  "mercedes", "dakota", "arsenal", "eagles", "melissa", "boomer", "booboo", "spider",
  "nascar", "monster", "tigers", "yellow", "xxxxxx", "123123123", "gateway", "marina",
  "diablo", "bulldog", "qwer1234", "compaq", "purple", "hardcore", "banana", "junior",
  "hannah", "startrek", "bandit", "zzzzzz", "666999", "hello123", "admin", "login",
  "passw0rd", "password1", "password123", "qwerty123", "1q2w3e4r", "abcd1234", "iloveyou1",
  "1q2w3e", "qwe123", "asd123", "a1b2c3", "trustno1!", "letmein123", "changeme",
] as const;

/** Lowercased set for O(1) membership checks. */
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set(COMMON_PASSWORD_LIST);
