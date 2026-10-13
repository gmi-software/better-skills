# Contributing

Thank you for helping improve GMI Agent Skills. This repository follows the [Agent Skills](https://github.com/vercel-labs/skills) format used by the official `skills` CLI and [skills.sh](https://skills.sh).

## Add a new skill

1. Create a directory under `skills/` using a lowercase, hyphenated slug:

   ```text
   skills/
     my-new-skill/
       SKILL.md
   ```

2. Add valid YAML frontmatter to `SKILL.md`:

   ```markdown
   ---
   name: my-new-skill
   description: >-
     One or two sentences describing what the skill does and when an agent
     should use it.
   license: MIT
   metadata:
     package: example-package
     repository: https://github.com/example/example-package
   ---

   # my-new-skill

   Skill instructions go here.
   ```

3. Keep these rules in mind:
   - `name` must match the directory name (`my-new-skill`).
   - `name` and `description` are required strings.
   - `name` must be lowercase alphanumeric with hyphens, max 64 characters.
   - `description` must be at most 1024 characters.
   - Do not add custom telemetry, network calls, or tracking inside skills.
   - Optional reference docs can live in `skills/my-new-skill/references/`.

4. If the skill belongs in a curated section on skills.sh, add its slug to an existing group in [`skills.sh.json`](skills.sh.json), or create a new group there. See [Customize repo pages](https://www.skills.sh/docs/customize).

5. Update [`README.md`](README.md) so the skill appears in the skills table and install examples.

6. Validate locally before opening a PR:

   ```sh
   npm install
   npm run validate
   ```

7. Test discovery with the official CLI:

   ```sh
   npx skills add . --list
   npx skills add . --skill my-new-skill -y
   ```

## Pull requests

- Keep changes focused on the skill you are adding or updating.
- Run `npm run validate` locally; CI runs the same check.
- Do not commit secrets, credentials, or generated artifacts.

## skills.sh listing

skills.sh discovers skills through anonymous install telemetry sent by the official CLI when someone installs from a public GitHub repository. Listing and install counts are not driven by GitHub topics or repository metadata alone.

After your skill merges, users can install it with:

```sh
npx skills add gmi-software/better-skills --skill my-new-skill
```

Individual skill pages use this URL pattern once the skill has been seen by the telemetry service:

```text
https://skills.sh/gmi-software/better-skills/my-new-skill
```
