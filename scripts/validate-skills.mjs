#!/usr/bin/env node

import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)));
const SKILLS_DIR = join(ROOT, 'skills');
const SKILLS_SH_JSON = join(ROOT, 'skills.sh.json');

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;

const errors = [];
const warnings = [];

function error(message) {
  errors.push(message);
}

function warn(message) {
  warnings.push(message);
}

function normalizeSkillName(name) {
  return name.toLowerCase().replace(/[\s_]+/g, '-');
}

function parseFrontmatter(content, skillPath) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/);
  if (!match) {
    error(`${skillPath}: missing YAML frontmatter delimiters (---)`);
    return null;
  }

  try {
    const data = parseYaml(match[1]);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      error(`${skillPath}: frontmatter must be a YAML mapping`);
      return null;
    }
    return data;
  } catch (err) {
    error(`${skillPath}: invalid YAML frontmatter (${err.message})`);
    return null;
  }
}

function validateSkillMetadata(skillPath, directoryName, data) {
  const { name, description } = data;

  if (name === undefined || name === null || name === '') {
    error(`${skillPath}: missing required frontmatter field "name"`);
  } else if (typeof name !== 'string') {
    error(`${skillPath}: frontmatter "name" must be a string (got ${typeof name})`);
  } else {
    if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
      error(`${skillPath}: "name" must be 1–${MAX_NAME_LENGTH} characters`);
    }
    if (!SKILL_NAME_PATTERN.test(name)) {
      error(
        `${skillPath}: "name" must be lowercase alphanumeric with hyphens (${name})`
      );
    }
    if (normalizeSkillName(name) !== normalizeSkillName(directoryName)) {
      error(
        `${skillPath}: frontmatter name "${name}" does not match directory "${directoryName}"`
      );
    }
  }

  if (description === undefined || description === null || description === '') {
    error(`${skillPath}: missing required frontmatter field "description"`);
  } else if (typeof description !== 'string') {
    error(
      `${skillPath}: frontmatter "description" must be a string (got ${typeof description})`
    );
  } else if (description.length > MAX_DESCRIPTION_LENGTH) {
    error(
      `${skillPath}: "description" must be at most ${MAX_DESCRIPTION_LENGTH} characters`
    );
  }
}

async function validateSkillsDirectory() {
  let entries;
  try {
    entries = await readdir(SKILLS_DIR, { withFileTypes: true });
  } catch {
    error('skills/ directory is missing');
    return [];
  }

  const skillDirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  if (skillDirs.length === 0) {
    error('skills/ contains no skill directories');
    return [];
  }

  const seenNames = new Map();
  const validatedSkills = [];

  for (const directoryName of skillDirs) {
    const skillDir = join(SKILLS_DIR, directoryName);
    const skillPath = join(skillDir, 'SKILL.md');

    let skillStat;
    try {
      skillStat = await stat(skillPath);
    } catch {
      error(`skills/${directoryName}/SKILL.md is missing`);
      continue;
    }

    if (!skillStat.isFile()) {
      error(`skills/${directoryName}/SKILL.md is not a file`);
      continue;
    }

    const content = await readFile(skillPath, 'utf8');
    const data = parseFrontmatter(content, `skills/${directoryName}/SKILL.md`);
    if (!data) {
      continue;
    }

    validateSkillMetadata(`skills/${directoryName}/SKILL.md`, directoryName, data);

    if (typeof data.name === 'string') {
      const normalized = normalizeSkillName(data.name);
      if (seenNames.has(normalized)) {
        error(
          `duplicate skill name "${data.name}" in ${seenNames.get(normalized)} and skills/${directoryName}/SKILL.md`
        );
      } else {
        seenNames.set(normalized, `skills/${directoryName}/SKILL.md`);
        validatedSkills.push({
          name: data.name,
          directoryName,
        });
      }
    }
  }

  return validatedSkills;
}

async function validateSkillsShJson(validatedSkills) {
  let raw;
  try {
    raw = await readFile(SKILLS_SH_JSON, 'utf8');
  } catch {
    warn('skills.sh.json is missing (optional, but recommended for skills.sh repo page layout)');
    return;
  }

  let config;
  try {
    config = JSON.parse(raw);
  } catch (err) {
    error(`skills.sh.json: invalid JSON (${err.message})`);
    return;
  }

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    error('skills.sh.json: root value must be an object');
    return;
  }

  if (!Array.isArray(config.groupings) || config.groupings.length === 0) {
    error('skills.sh.json: "groupings" must be a non-empty array');
    return;
  }

  const knownNames = new Set(
    validatedSkills.map(({ name }) => normalizeSkillName(name))
  );
  const referenced = new Set();

  for (const [index, group] of config.groupings.entries()) {
    const label = `skills.sh.json groupings[${index}]`;

    if (!group || typeof group !== 'object' || Array.isArray(group)) {
      error(`${label}: must be an object`);
      continue;
    }

    if (typeof group.title !== 'string' || group.title.trim().length === 0) {
      error(`${label}: "title" must be a non-empty string`);
    }

    if (!Array.isArray(group.skills) || group.skills.length === 0) {
      error(`${label}: "skills" must be a non-empty array`);
      continue;
    }

    for (const skillName of group.skills) {
      if (typeof skillName !== 'string' || skillName.trim().length === 0) {
        error(`${label}: every entry in "skills" must be a non-empty string`);
        continue;
      }

      const normalized = normalizeSkillName(skillName);
      referenced.add(normalized);

      if (!knownNames.has(normalized)) {
        error(
          `${label}: references unknown skill "${skillName}" (not found under skills/)`
        );
      }
    }
  }

  for (const { name, directoryName } of validatedSkills) {
    if (!referenced.has(normalizeSkillName(name))) {
      warn(
        `skills.sh.json does not group skill "${name}" (skills/${directoryName}/); it will appear under "Other skills" on skills.sh`
      );
    }
  }
}

async function main() {
  const validatedSkills = await validateSkillsDirectory();
  await validateSkillsShJson(validatedSkills);

  for (const message of warnings) {
    console.warn(`warning: ${message}`);
  }

  if (errors.length > 0) {
    for (const message of errors) {
      console.error(`error: ${message}`);
    }
    console.error(`\n${errors.length} validation error(s)`);
    process.exit(1);
  }

  console.log(`Validated ${validatedSkills.length} skill(s) in skills/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
