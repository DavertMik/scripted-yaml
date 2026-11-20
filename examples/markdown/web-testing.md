---
name: web-testing
target: pr
description!mdq: section1 paragraph[0]

$vars:
  EXPLORBOT_URL: { optional: true }

stages:
  - id: review
    title: Review
    session: qa
    task!mdq: section("Review")

  - id: plan
    title: Test plan
    session: qa
    when!: vars.EXPLORBOT_URL != null
    task!mdq: section("Test plan")
    checks!mdq: section("Test plan") item
---

# Web testing

Review a pull request, test the change in a browser, explain what broke.

## Review

Review this pull request as a QA engineer.
List the scenarios worth checking in a browser. /qa-review-pr

## Test plan

Turn the browser scenarios in review.md into an Explorbot test plan
for the staging site in plan.md. /explorbot-plan

- Cover the changed pages first.
- Skip anything behind a feature flag.
