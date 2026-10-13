# GMI Agent Skills

Open-source [Agent Skills](https://github.com/vercel-labs/skills) for AI coding agents and React Native developers.

This repository covers GMI Software React Native libraries plus a neutral ecosystem skill for [`react-native-maps`](https://www.npmjs.com/package/react-native-maps).

Repository: [gmi-software/better-skills](https://github.com/gmi-software/better-skills)

## Install

Install from the full catalog:

```sh
npx skills add gmi-software/better-skills
```

The CLI discovers skills under `skills/<skill-name>/SKILL.md` and opens an interactive selector unless you pass flags.

Install one skill:

```sh
npx skills add gmi-software/better-skills --skill react-native-maps
npx skills add gmi-software/better-skills --skill react-native-better-maps
npx skills add gmi-software/better-skills --skill react-native-better-clustering
npx skills add gmi-software/better-skills --skill react-native-pay
```

Install every skill without prompts:

```sh
npx skills add gmi-software/better-skills --skill '*' -y
```

### List available skills

```sh
npx skills add gmi-software/better-skills --list
```

From a local checkout:

```sh
npx skills add . --list
```

Search the public catalog (requires network access):

```sh
npx skills find react-native-maps
npx skills find maps --owner gmi-software
```

## Skills

Verified against published npm packages / upstream source on 2026-08-21.

| Skill | Canonical ID | Package | Version | Source |
| --- | --- | --- | --- | --- |
| [react-native-maps](skills/react-native-maps/) | `gmi-software/better-skills/react-native-maps` | [react-native-maps](https://www.npmjs.com/package/react-native-maps) | 1.29.0 | [`863dc3c53aa1`](https://github.com/react-native-maps/react-native-maps/commit/863dc3c53aa17c0aac8c80415b91ed30d6a4f478) |
| [react-native-better-maps](skills/react-native-better-maps/) | `gmi-software/better-skills/react-native-better-maps` | [react-native-better-maps](https://www.npmjs.com/package/react-native-better-maps) | 1.1.0 | [`b9a178334913`](https://github.com/gmi-software/react-native-better-maps/commit/b9a178334913043b3aa2542fb528731debaad4f5) |
| [react-native-better-clustering](skills/react-native-better-clustering/) | `gmi-software/better-skills/react-native-better-clustering` | [react-native-better-clustering](https://www.npmjs.com/package/react-native-better-clustering) | 1.0.0 | [`7c7d659046a3`](https://github.com/gmi-software/react-native-better-clustering/commit/7c7d659046a3d1bb8b7d4cb06a94f6e0d509862e) |
| [react-native-pay](skills/react-native-pay/) | `gmi-software/better-skills/react-native-pay` | [@gmisoftware/react-native-pay](https://www.npmjs.com/package/@gmisoftware/react-native-pay) | 0.0.16 | [`2078fdda8bde`](https://github.com/gmi-software/react-native-pay/commit/2078fdda8bdef87b51d20039d7684a255f0baadc) |

Directory names, `SKILL.md` frontmatter `name` fields, and `--skill` values all use the same slug (for example, `react-native-maps`).

## skills.sh discovery and install tracking

[skills.sh](https://skills.sh) is the public directory for Agent Skills. Important details:

- **CLI install always works from GitHub.** `npx skills add gmi-software/better-skills` clones the repository and reads `skills/*/SKILL.md`; it does not depend on skills.sh being indexed first.
- **skills.sh listing is telemetry-driven.** When someone installs from a public GitHub source, the official CLI sends anonymous install telemetry to the skills service (see [`src/telemetry.ts`](https://github.com/vercel-labs/skills/blob/main/src/telemetry.ts) in `vercel-labs/skills`). That is how skills enter search, leaderboards, and install counts. There is no GitHub crawler for arbitrary skill repositories.
- **Local installs are not tracked.** `npx skills add .` skips remote telemetry because there is no public GitHub source.
- **Opt out is supported.** Set `DISABLE_TELEMETRY=1` or `DO_NOT_TRACK=1` to disable CLI telemetry entirely.
- **Repo page layout.** [`skills.sh.json`](skills.sh.json) groups skills on the repository page once skills.sh has seen installs from this repo. See [Customize repo pages](https://www.skills.sh/docs/customize).
- **Individual skill URLs** follow `https://skills.sh/gmi-software/better-skills/<skill-name>` once a skill has been seen by the telemetry service.
- **Do not add custom tracking inside skills.** Keep `SKILL.md` and reference docs free of analytics requests; install analytics are handled by the official CLI only.

As of 2026-08-24, this repository’s skills were not yet returned by the public search endpoint used by `npx skills find` (`GET https://skills.sh/api/search`). That usually means no qualifying installs have been recorded yet. After users install from `gmi-software/better-skills`, check discovery with:

```sh
npx skills find react-native-maps --owner gmi-software
```

The authenticated v1 API (`https://skills.sh/api/v1/...`) is documented at [skills.sh/docs/api](https://www.skills.sh/docs/api) and requires a Vercel OIDC token.

## Validate locally

```sh
npm install
npm run validate
```

This checks every `skills/*/SKILL.md` for valid frontmatter, unique names, directory/name alignment, and consistency with `skills.sh.json`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add or update a skill.

## Try it

Once installed, ask naturally:

```text
Why does react-native-maps perform badly on Android?
```

```text
Help me debug why react-native-better-clustering is slow with 20k markers.
```

```text
How do I migrate from react-native-maps to react-native-better-maps?
```

```text
Implement Apple Pay with @gmisoftware/react-native-pay.
```

## License

MIT — see [`LICENSE`](LICENSE).
