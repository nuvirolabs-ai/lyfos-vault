# Talking Points + Counter-positions

Pre-baked angles and the honest answer when journalists push back.

## Angle: "Why now? Hasn't this been a problem forever?"

It's been a problem forever. What's new is that the problem now lives
inside locked phones. A generation ago, a relative could go through a
desk drawer and find everything. Today, the desk drawer is a Face ID
prompt. The paper-trail solution doesn't work anymore. Lyfos is the
first product designed for that reality.

## Angle: "Isn't this just a password manager?"

A password manager solves: "I can't remember my own passwords." Lyfos
solves: "My family can't recover my records if I'm not here." Those are
adjacent problems with different solutions. Password managers trust one
user. Lyfos trusts five.

## Angle: "Why don't you do nominee KYC?"

We considered it and rejected it. The argument is in our blog post —
the short version: nominee KYC fails at the moment it matters most,
because the family is grieving and the documents are in a drawer. The
real trust comes from the five humans the user chose, plus the 14-day
hold, plus the multi-channel alerts.

## Angle: "What stops three of the holders from colluding while the
owner is alive?"

Nothing in the architecture stops it — by design. We trust the user's
choice of holders. What we do stop is the release happening without
the owner having two weeks to find out and abort. If three holders
genuinely conspire and the owner is alive but unreachable on all four
channels for 14 days, then the design has accepted that risk.

## Counter: "What if Lyfos is hacked?"

A breach of our database leaks ciphertext. The vault key derives from
the user's passphrase, which we never see. The attacker would need to
brute-force Argon2id against each vault individually — economically
intractable. The threat model document covers this scenario in detail.

## Counter: "What if Lyfos goes out of business?"

Your vault is local-first. You always have a copy. Your 24-word recovery
phrase decrypts it without our cooperation. The release engine relies on
our servers, but the static vault never does. We also publish a
continuity plan including a sealed credentials envelope for the backup
operator.

## Counter: "What if the founder dies tomorrow?"

We have a documented bus-factor plan including a primary and secondary
backup operator with access to the sealed credentials envelope. The
product is autonomous for users in normal flows — only the admin review
of release claims needs a human, and that's documented as a runbook.

## Counter: "Why should anyone trust a one-person startup with this?"

You shouldn't trust *us* — you should trust the *protocol*. The whole
point of zero-knowledge architecture is that trust is verifiable, not
assumed. The threat model, the crypto primitives, the audit findings,
and the death-simulation runbook are all public. If we ever change the
architecture to require trust, we'll have to ship a new app version you
explicitly accept.

## Counter: "₹999/year feels expensive for a vault."

It's about ₹83 a month. For a product that exists to keep your family
from spending six months untangling your accounts, that math is
straightforward. We considered cheaper, but the messaging costs of the
release engine alone need ₹50-200 per active release, and reliability
at that cost requires margin. Most password managers charge more for
less.

## Counter: "What's stopping you from pivoting to selling user data?"

The architecture stops us — we don't have plaintext to sell. The
business model stops us — your subscription pays for the service. The
incorporation stops us — there's no investor pressure for growth at any
cost. And the press would stop us — the moment we shipped a sellable
data feature would be the moment our existing users would credibly
crucify us. None of those alone is sufficient. All four together is.
