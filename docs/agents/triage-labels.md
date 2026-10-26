# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the "Label in our tracker" column to match whatever vocabulary you actually use.

All five labels already exist in `cs1lion/pixel-world-engine`.

They are in use: as of 2026-10-27 every open ticket carries `ready-for-agent`. That is a statement about one moment, not an invariant — #5 and #6 were open when an earlier version of this line named them, and they have since closed. So do not read a ticket list off this page; check it:

```bash
gh issue list --label ready-for-agent --state open
```

What is stable is the label set above, not which tickets carry it.
