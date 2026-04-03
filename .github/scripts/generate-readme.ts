import { writeFileSync } from "fs";

const OWNER = "DidiervanH";
const ORGS = ["Nexus-Automations", "ellie-languages"] as const;

interface Repo {
  name: string;
  description: string | null;
  html_url: string;
  fork: boolean;
  archived: boolean;
  private: boolean;
  pushed_at: string;
}

async function fetchRepos(
  owner: string,
  type: "users" | "orgs"
): Promise<Repo[]> {
  const repos: Repo[] = [];
  let page = 1;
  const token = process.env.GH_TOKEN;

  while (true) {
    const url =
      type === "users" && token
        ? `https://api.github.com/user/repos?per_page=100&sort=pushed&direction=desc&affiliation=owner&page=${page}`
        : `https://api.github.com/${type}/${owner}/repos?per_page=100&sort=pushed&direction=desc&page=${page}`;

    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        ...(token && { Authorization: `Bearer ${token}` }),
      },
    });

    const data: Repo[] = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;

    const owned =
      type === "users"
        ? data.filter((r) => r.html_url?.includes(`/${owner}/`))
        : data;

    repos.push(...owned.filter((r) => !r.fork && !r.archived));
    if (data.length < 100) break;
    page++;
  }

  return repos.sort(
    (a, b) =>
      new Date(b.pushed_at).getTime() - new Date(a.pushed_at).getTime()
  );
}

function formatRepoSection(repos: Repo[], excludeName: string): string {
  const filtered = repos.filter(
    (r) =>
      r.name.toLowerCase() !== excludeName.toLowerCase() &&
      !r.name.startsWith(".")
  );
  if (filtered.length === 0) return "_No repositories to show._";

  const publicRepos = filtered.filter((r) => !r.private);
  const privateCount = filtered.filter((r) => r.private).length;

  const parts: string[] = [];

  if (publicRepos.length > 0) {
    const rows = publicRepos.map(
      (r) => `| [**${r.name}**](${r.html_url}) | ${r.description ?? ""} |`
    );
    parts.push(
      ["| Project | Description |", "| --- | --- |", ...rows].join("\n")
    );
  }

  if (privateCount > 0) {
    parts.push(
      `*+ ${privateCount} private ${privateCount === 1 ? "repository" : "repositories"}*`
    );
  }

  return parts.join("\n\n");
}

const [personalRepos, ...orgRepos] = await Promise.all([
  fetchRepos(OWNER, "users"),
  ...ORGS.map((org) => fetchRepos(org, "orgs")),
]);

const orgSections = ORGS.map(
  (org, i) => `#### [@${org}](https://github.com/${org})

${formatRepoSection(orgRepos[i], org)}`
).join("\n\n");

const readme = `<div align="center">

<picture>
<source media="(prefers-color-scheme: dark)" srcset="assets/banner-dark.webp" />
<source media="(prefers-color-scheme: light)" srcset="assets/banner-light.webp" />
<img alt="Didier van Hooren — Customer of my own products" src="assets/banner-dark.webp" width="100%" />
</picture>

</div>

### About Me

- Customer of my own products
- Primary languages: **TypeScript**, **Python**, **SQL**
- Interests: AI workflows, agentic development, automation, iOS

[![LinkedIn](https://img.shields.io/badge/LinkedIn-%230A66C2?style=flat&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/didiervanhooren/)

[![GitHub stars](https://img.shields.io/github/stars/${OWNER}?style=flat&logo=github&label=Stars&color=3B82F6)](https://github.com/${OWNER}?tab=repositories) [![Profile views](https://komarev.com/ghpvc/?username=${OWNER}&color=3B82F6&style=flat&label=Profile+views)](https://github.com/${OWNER})

[![TypeScript](https://img.shields.io/badge/TypeScript-%233178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org) [![Python](https://img.shields.io/badge/Python-%233776AB?style=flat&logo=python&logoColor=white)](https://www.python.org) [![Bun](https://img.shields.io/badge/Bun-%23000000?style=flat&logo=bun&logoColor=white)](https://bun.sh) [![Claude](https://img.shields.io/badge/Claude-%23D97757?style=flat&logo=claude&logoColor=white)](https://claude.ai) [![Vue](https://img.shields.io/badge/Vue-%234FC08D?style=flat&logo=vuedotjs&logoColor=white)](https://vuejs.org) [![Astro](https://img.shields.io/badge/Astro-%23BC52EE?style=flat&logo=astro&logoColor=white)](https://astro.build) [![Docker](https://img.shields.io/badge/Docker-%232496ED?style=flat&logo=docker&logoColor=white)](https://www.docker.com) [![Tauri](https://img.shields.io/badge/Tauri-%23FFC131?style=flat&logo=tauri&logoColor=black)](https://tauri.app) [![PostHog](https://img.shields.io/badge/PostHog-%231D4AFF?style=flat&logo=posthog&logoColor=white)](https://posthog.com) [![PostgreSQL](https://img.shields.io/badge/PostgreSQL-%234169E1?style=flat&logo=postgresql&logoColor=white)](https://www.postgresql.org) [![Playwright](https://img.shields.io/badge/Playwright-%232EAD33?style=flat&logo=playwright&logoColor=white)](https://playwright.dev)

### GitHub Stats

<div align="center">

<picture>
<source media="(prefers-color-scheme: dark)" srcset="https://streak-stats.demolab.com?user=${OWNER}&theme=tokyonight&hide_border=true&background=00000000" />
<source media="(prefers-color-scheme: light)" srcset="https://streak-stats.demolab.com?user=${OWNER}&theme=default&hide_border=true&background=00000000" />
<img alt="GitHub Streak" src="https://streak-stats.demolab.com?user=${OWNER}&theme=default&hide_border=true&background=00000000" />
</picture>

</div>

### Projects

#### Personal

${formatRepoSection(personalRepos, OWNER)}

#### Organisations

${orgSections}

### Contributions

<div align="center">
<picture>
<source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/${OWNER}/${OWNER}/output/profile-night-view.svg" />
<source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/${OWNER}/${OWNER}/output/profile-green-animate.svg" />
<img alt="3D Contribution Calendar" src="https://raw.githubusercontent.com/${OWNER}/${OWNER}/output/profile-green-animate.svg" />
</picture>
</div>
`;

writeFileSync("README.md", readme);

const personalCount = personalRepos.filter(
  (r) => r.name.toLowerCase() !== OWNER.toLowerCase() && !r.name.startsWith(".")
).length;
const orgCount = orgRepos.reduce(
  (sum, repos) =>
    sum + repos.filter((r) => !r.name.startsWith(".")).length,
  0
);
console.log(
  `Generated README.md with ${personalCount} personal and ${orgCount} org repos`
);
