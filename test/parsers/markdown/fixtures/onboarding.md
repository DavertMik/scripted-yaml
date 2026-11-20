---
name: onboarding
summary!mdq: section1 paragraph[0]

$vars:
  TEAM: { default: platform }
  BUDDY: { optional: true }

greeting: Welcome to the {{ vars.TEAM }} team
has_buddy!: vars.BUDDY != null

steps:
  - id: accounts
    title: Accounts
    text!mdq: section("Accounts")
    tools!rows: section("Accounts") table

  - id: buddy
    title: Meet {{ vars.BUDDY }}
    text!mdq: section("Buddy") paragraph
    $if!: has_buddy

  - id: first-task
    title: First task
    text!mdq: section("First task") paragraph
    checklist!mdq: section("First task") item
---

# Onboarding

Everything a new engineer does in the first week.

## Accounts

Ask for these on day one.

| tool   | owner |
| ------ | ----- |
| GitHub | Ann   |
| Sentry | Raj   |

## Buddy

Your buddy answers questions for {{ two }} weeks.

## First task

Pick an issue labelled `starter`.

- Open a draft pull request early.
- Ask for a review from your buddy.
