# GMI Agent Skills

Open-source [Agent Skills](https://github.com/vercel-labs/skills) for AI coding agents and React Native developers.

This repository covers GMI Software React Native libraries plus a neutral ecosystem skill for [`react-native-maps`](https://www.npmjs.com/package/react-native-maps).

Repository: [gmi-software/agent-skills](https://github.com/gmi-software/agent-skills)

## Install

```sh
npx skills add gmi-software/agent-skills
```

Then pick the skills you want from the interactive selector.

Install one skill:

```sh
npx skills add gmi-software/agent-skills --skill react-native-maps
npx skills add gmi-software/agent-skills --skill react-native-better-maps
npx skills add gmi-software/agent-skills --skill react-native-better-clustering
npx skills add gmi-software/agent-skills --skill react-native-pay
```

## Skills

Verified against published npm packages / upstream source on 2026-08-21.

| Skill | Package | Version | Source |
| --- | --- | --- | --- |
| [react-native-maps](skills/react-native-maps/) | [react-native-maps](https://www.npmjs.com/package/react-native-maps) | 1.29.0 | [`863dc3c53aa1`](https://github.com/react-native-maps/react-native-maps/commit/863dc3c53aa17c0aac8c80415b91ed30d6a4f478) |
| [react-native-better-maps](skills/react-native-better-maps/) | [react-native-better-maps](https://www.npmjs.com/package/react-native-better-maps) | 1.1.0 | [`b9a178334913`](https://github.com/gmi-software/react-native-better-maps/commit/b9a178334913043b3aa2542fb528731debaad4f5) |
| [react-native-better-clustering](skills/react-native-better-clustering/) | [react-native-better-clustering](https://www.npmjs.com/package/react-native-better-clustering) | 1.0.0 | [`7c7d659046a3`](https://github.com/gmi-software/react-native-better-clustering/commit/7c7d659046a3d1bb8b7d4cb06a94f6e0d509862e) |
| [react-native-pay](skills/react-native-pay/) | [@gmisoftware/react-native-pay](https://www.npmjs.com/package/@gmisoftware/react-native-pay) | 0.0.16 | [`2078fdda8bde`](https://github.com/gmi-software/react-native-pay/commit/2078fdda8bdef87b51d20039d7684a255f0baadc) |

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
