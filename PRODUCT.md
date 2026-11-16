# Product

## Register

product

## Users

Thai lottery players, mostly on phones, playing several draws a day. One player's day looks like this: stock-index rounds in the morning (Nikkei, China, Hang Seng), Yiki every 15 minutes, Hanoi and Laos in the evening, and the Thai government draw on the 1st and 16th. They open the site in short bursts: on the train, at work, in bed. Usually they're racing a cutoff a few minutes away. Some are anxious about whether a deposit or a win was credited.

Operators (admins) run the back office on desktop. They set draw schedules, enter results, approve deposits and withdrawals, and watch how much money rides on each number so a single hot number can't bankrupt a round.

## Product Purpose

โชคประทาน is an online lottery betting site: lobby of every draw with live countdowns, a fast bet-slip builder, bills, results, wallet, referrals, cashback, promotions, and a full admin back office. Its edge over competitors such as ดั่งหวัง is trust and speed. Money and rules stay legible, and every payout rate is visible before you bet, including rates the system has cut automatically because too much was staked on a number. On a computer it's a real desktop layout, not a phone screen stretched down the middle.

Success: a player can go from landing to a confirmed bill in under 30 seconds, never wonders where their money is, and sees the same rate on the slip that they're paid at.

## Production scope (decided 2026-11-06)

The owner runs this for real money on MariaDB. Requirements: a full dashboard, 5 admin-selectable colour themes (the original violet kept), staff roles and permissions, many reports with CSV export, and every flow working end to end (slip upload, OTP by SMS when configured, bulk result entry). Security and behaviour under heavy traffic come first: no double spending, no cap overruns, every staff action audited, 2FA for staff, production installs locked out of demo features.

## Brand Personality

Trustworthy, precise, calm. The voice is that of a good Thai bank app: plain Thai, exact numbers, no hype, no "จ่ายจริง 100%" shouting. Luck and celebration show up only at the moment of a win (gold), never as decoration.

## Anti-references

- Competitor lotto sites (ดั่งหวัง and its 17 sister brands): red-gold Chinese New Year banners, text baked into images, every countdown the same red pill, desktop as a stretched phone.
- Casino glitz: neon glow, gradient text, confetti on page load.
- Text baked into images. Banner text is real HTML so it stays sharp, translatable and readable by screen readers (admins may still upload a finished banner image and hide the text).
- Generic SaaS: hero-metric templates, identical icon-card grids, eyebrow labels on every section.

## Imagery (decided 2026-11-06)

The owner wants image-led customer pages because Thai players respond to pictures: a promotional slider on the home page and illustrations throughout. Imagery is original vector art in the brand palette (gold coins, lottery balls, tickets, gift boxes, red envelopes, phones, trophies). No photos of real people (no model releases for gambling promotion), no Thai banknotes or official lottery emblems.

## Design Principles

1. **Show the number before the click.** Rates, limits, cut rates, and closing times are visible wherever a decision is made.
2. **Money is never ambiguous.** Balances, stakes, and payouts use one format and tabular digits, and every money movement leaves a record the player can find.
3. **Urgency is earned.** Only a round about to close looks urgent. Everything else stays calm.
4. **Fast hands, forgiving system.** Keyboard and keypad entry, bulk tools (19 ประตู, กลับเลข), and an easy undo. The server re-checks everything before money moves.
5. **The operator is a user too.** Admin screens get the same care: dense, legible, and safe for risky actions.

## Accessibility & Inclusion

WCAG 2.2 AA throughout. Body text ≥ 16px, Thai line-height ≥ 1.6. Touch targets ≥ 44px. Color is never the only signal: urgent, cut, and closed states also carry text or icons. Every animation has a `prefers-reduced-motion` path. Full keyboard support on the bet slip.
