# Digital Legacy Score Specification 1.0

## Purpose

The score explains preparation. It does not certify security, guarantee recovery, or reward password storage.

```text
Overall = 40% Coverage + 40% Readiness + 20% Freshness
```

All component and overall values are rounded to integers between 0 and 100. Inputs stay inside the unlocked encrypted vault and scores are derived locally.

## Coverage

Coverage denominator: the 14 built-in life categories. The custom-category facility is not part of the denominator.

A category counts as reviewed when:

- At least one record belongs to it, or
- The owner explicitly marks it `reviewed`, or
- The owner explicitly marks it `not_applicable`.

This avoids forcing irrelevant services and prevents empty categories from being counted by assumption.

## Readiness

Each record receives:

| Criterion | Weight |
| --- | ---: |
| Account identified | 15 |
| Recovery path documented | 20 |
| Legacy action selected | 20 |
| Nominee intent assigned | 20 |
| Supporting information included | 10 |
| Release condition configured | 15 |

A password, PIN, recovery code, private key, seed phrase, or other authentication secret is never a readiness criterion.

The readiness component is the average of record readiness values. An empty record set scores zero.

## Freshness

Default bands:

| Age since confirmation | State | Value |
| --- | --- | ---: |
| 0–90 days | Current | 100 |
| 91–180 days | Review recommended | 70 |
| 181–365 days | Needs review | 35 |
| More than 365 days or never reviewed | Potentially outdated | 0 |

Intervals are explicit function options so future product policy can change without rewriting stored records.

## Language

| Overall value | Label |
| --- | --- |
| 0 | Not started |
| 1–39 | Early preparation |
| 40–69 | Partially prepared |
| 70–89 | Well prepared |
| 90–100 | Strongly prepared |

Prohibited score claims include “completely safe,” “fully secure,” “guaranteed protection,” and “100% protected.”

## Priority actions

The current deterministic priority is:

1. Action required.
2. Incomplete.
3. Needs review.

At most three actions are returned. Ordering is stable within a priority group. Messages identify preparation work and do not make security guarantees.

## Example

If Coverage is 50, Readiness is 70, and Freshness is 100:

```text
(50 × 0.4) + (70 × 0.4) + (100 × 0.2) = 68
```

Display: “Your digital legacy is 68% prepared” and show the three component values separately.
