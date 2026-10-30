import { mkdirSync, writeFileSync } from "fs";

const OWNER = "DidiervanH";
const ORGS = ["Nexus-Automations", "ellie-languages"] as const;
const CONTRIBUTION_EMAILS = [
  "didier@get-ellie.com",
  "didiervanhooren@hotmail.com",
  "didier@nexus-automations.de",
] as const;
const today = new Date();
const CONTRIBUTION_END_DATE = new Date(
  Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
);
const priorYear = CONTRIBUTION_END_DATE.getUTCFullYear() - 1;
const priorMonth = CONTRIBUTION_END_DATE.getUTCMonth();
const priorMonthLastDay = new Date(Date.UTC(priorYear, priorMonth + 1, 0)).getUTCDate();
const CONTRIBUTION_START_DATE = new Date(
  Date.UTC(
    priorYear,
    priorMonth,
    Math.min(CONTRIBUTION_END_DATE.getUTCDate(), priorMonthLastDay)
  )
);
const CONTRIBUTION_START = CONTRIBUTION_START_DATE.toISOString().slice(0, 10);
const CONTRIBUTION_END = CONTRIBUTION_END_DATE.toISOString().slice(0, 10);
const SEARCH_RESULT_LIMIT = 1000;
const SEARCH_REQUEST_DELAY_MS = 5000;
const MAX_RATE_LIMIT_RETRIES = 5;

interface Repo {
  name: string;
  description: string | null;
  html_url: string;
  fork: boolean;
  archived: boolean;
  private: boolean;
  pushed_at: string;
}

interface CommitSearchResult {
  total_count: number;
  incomplete_results: boolean;
  items: Array<{
    sha: string;
    commit: { author: { date: string } | null };
  }>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchCommitSearchPage(
  query: string,
  page: number,
  token: string
): Promise<CommitSearchResult> {
  const url = new URL("https://api.github.com/search/commits");
  url.searchParams.set("q", query);
  url.searchParams.set("per_page", "100");
  url.searchParams.set("page", String(page));

  for (let retry = 0; ; retry++) {
    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (res.ok) return (await res.json()) as CommitSearchResult;

    const detail = await res.text();
    const rateLimited =
      (res.status === 403 || res.status === 429) &&
      (/rate limit/i.test(detail) || res.headers.get("x-ratelimit-remaining") === "0");
    if (!rateLimited || retry >= MAX_RATE_LIMIT_RETRIES) {
      throw new Error(`GitHub commit search failed (${res.status}): ${detail}`);
    }

    const retryAfter = res.headers.get("retry-after");
    const retryAfterSeconds = Number(retryAfter);
    const resetHeader = res.headers.get("x-ratelimit-reset");
    const resetAt = Number(resetHeader);
    const waitMs =
      retryAfter !== null && Number.isFinite(retryAfterSeconds)
        ? retryAfterSeconds * 1000
        : res.headers.get("x-ratelimit-remaining") === "0" &&
            resetHeader !== null &&
            Number.isFinite(resetAt)
          ? Math.max(1000, resetAt * 1000 - Date.now() + 1000)
          : 60000 * 2 ** retry;
    console.warn(
      `GitHub rate limit reached; waiting ${Math.ceil(waitMs / 1000)} seconds before retry ${retry + 1}/${MAX_RATE_LIMIT_RETRIES}.`
    );
    await sleep(waitMs);
  }
}

async function fetchEmailCommits(
  email: string,
  start: string,
  end: string,
  token: string,
  commits: Map<string, string>
): Promise<void> {
  const query = `author-email:${email} author-date:${start}..${end}`;
  // GitHub's search API caps a query at 1,000 results. Split saturated date
  // ranges recursively so every matching commit can be fetched.
  await sleep(SEARCH_REQUEST_DELAY_MS);
  const firstPage = await fetchCommitSearchPage(query, 1, token);
  if (firstPage.incomplete_results) {
    throw new Error(
      `GitHub returned incomplete commit search results for ${email} (${start}..${end}).`
    );
  }
  if (firstPage.total_count >= SEARCH_RESULT_LIMIT) {
    const startTime = Date.parse(`${start}T00:00:00Z`);
    const endTime = Date.parse(`${end}T00:00:00Z`);
    if (start === end) {
      throw new Error(
        `More than ${SEARCH_RESULT_LIMIT - 1} commits match ${email} on ${start}; cannot retrieve all results from GitHub search.`
      );
    }
    const dayCount = Math.floor((endTime - startTime) / 86400000) + 1;
    const middleTime = startTime + Math.floor(dayCount / 2) * 86400000;
    const middle = new Date(middleTime).toISOString().slice(0, 10);
    const dayBeforeMiddle = new Date(middleTime - 86400000)
      .toISOString()
      .slice(0, 10);
    await fetchEmailCommits(email, start, dayBeforeMiddle, token, commits);
    await fetchEmailCommits(email, middle, end, token, commits);
    return;
  }

  const pages = Math.ceil(firstPage.total_count / 100);
  for (let page = 1; page <= pages; page++) {
    const result =
      page === 1
        ? firstPage
        : await fetchCommitSearchPage(query, page, token);
    if (result.incomplete_results) {
      throw new Error(
        `GitHub returned incomplete commit search results for ${email} (${start}..${end}).`
      );
    }
    for (const item of result.items) {
      const authoredAt = item.commit.author?.date;
      if (authoredAt) commits.set(item.sha, authoredAt.slice(0, 10));
    }
    if (page < pages) await sleep(SEARCH_REQUEST_DELAY_MS);
  }
}

function getCommitCountsByDate(
  commits: Map<string, string>,
  startDate: string,
  endDate: string
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const date of commits.values()) {
    if (date >= startDate && date <= endDate) {
      counts.set(date, (counts.get(date) ?? 0) + 1);
    }
  }
  return counts;
}

function renderContributionCalendar(
  commits: Map<string, string>,
  startDate: string,
  endDate: string
): string {
  const counts = getCommitCountsByDate(commits, startDate, endDate);

  const rangeStart = new Date(`${startDate}T00:00:00Z`);
  const rangeEnd = new Date(`${endDate}T00:00:00Z`);
  const gridStart = new Date(rangeStart);
  gridStart.setUTCDate(gridStart.getUTCDate() - gridStart.getUTCDay());
  const gridEnd = new Date(rangeEnd);
  gridEnd.setUTCDate(gridEnd.getUTCDate() + (6 - gridEnd.getUTCDay()));
  const totalDays = Math.round((gridEnd.getTime() - gridStart.getTime()) / 86400000) + 1;
  const weekCount = totalDays / 7;
  const cell = 10;
  const gap = 3;
  const step = cell + gap;
  const left = 38;
  const top = 52;
  const width = left + weekCount * step + 8;
  const height = top + 7 * step + 36;
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const colors = ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"];
  const colorFor = (count: number) => {
    if (count === 0) return colors[0];
    if (count < 3) return colors[1];
    if (count < 6) return colors[2];
    if (count < 10) return colors[3];
    return colors[4];
  };

  const monthLabels: string[] = [];
  const firstMonth = new Date(
    Date.UTC(rangeStart.getUTCFullYear(), rangeStart.getUTCMonth(), 1)
  );
  let previousMonthWeek = -1;
  for (
    const date = firstMonth;
    date <= rangeEnd;
    date.setUTCMonth(date.getUTCMonth() + 1)
  ) {
    const labelDate = date < rangeStart ? rangeStart : date;
    const week = Math.floor((labelDate.getTime() - gridStart.getTime()) / 604800000);
    if (week > previousMonthWeek) {
      const monthName = date.toLocaleString("en", {
        month: "short",
        timeZone: "UTC",
      });
      const label =
        date.getUTCMonth() === rangeStart.getUTCMonth() ||
        date.getUTCMonth() === rangeEnd.getUTCMonth()
          ? `${monthName} '${String(date.getUTCFullYear()).slice(-2)}`
          : monthName;
      monthLabels.push(
        `<text x="${left + week * step}" y="38" class="month">${label}</text>`
      );
      previousMonthWeek = week;
    }
  }
  const dayLabels = ["Mon", "Wed", "Fri"]
    .map((label, i) => `<text x="0" y="${top + (i * 2 + 1) * step + 8}" class="day">${label}</text>`)
    .join("");

  const cells: string[] = [];
  for (let dayIndex = 0; dayIndex < totalDays; dayIndex++) {
    const date = new Date(gridStart.getTime() + dayIndex * 86400000);
    const dateKey = date.toISOString().slice(0, 10);
    if (dateKey < startDate || dateKey > endDate) continue;
    const count = counts.get(dateKey) ?? 0;
    const week = Math.floor(dayIndex / 7);
    const weekday = date.getUTCDay();
    const x = left + week * step;
    const y = top + weekday * step;
    cells.push(
      `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" fill="${colorFor(count)}"><title>${dateKey}: ${count} ${count === 1 ? "commit" : "commits"}</title></rect>`
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
<title id="title">Email-matched GitHub commits over the last 12 months</title>
<desc id="desc">${total} commits authored with one of the linked email addresses from ${startDate} through ${endDate}, grouped by author date.</desc>
<style>text{font-family:Arial,sans-serif;fill:#57606a}.total{font-size:16px;font-weight:600;fill:#24292f}.month,.day{font-size:10px}</style>
<text x="0" y="20" class="total">${total} matching commits · ${startDate} to ${endDate}</text>
${monthLabels.join("")}${dayLabels}${cells.join("")}
</svg>`;
}

function renderContributionStats(
  commits: Map<string, string>,
  startDate: string,
  endDate: string
): string {
  const counts = getCommitCountsByDate(commits, startDate, endDate);
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const activeDays = new Set(counts.keys());
  const dayKey = (date: Date) => date.toISOString().slice(0, 10);
  const dayBeforeEnd = new Date(end);
  dayBeforeEnd.setUTCDate(dayBeforeEnd.getUTCDate() - 1);
  const streakAnchor = activeDays.has(endDate)
    ? end
    : dayBeforeEnd >= start && activeDays.has(dayKey(dayBeforeEnd))
      ? dayBeforeEnd
      : null;

  let currentStreak = 0;
  let currentStart = streakAnchor ? new Date(streakAnchor) : null;
  if (streakAnchor && currentStart) {
    const cursor = new Date(streakAnchor);
    while (cursor >= start && activeDays.has(dayKey(cursor))) {
      currentStreak++;
      currentStart = new Date(cursor);
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
  }

  let longestStreak = 0;
  let longestStart: Date | null = null;
  let longestEnd: Date | null = null;
  let runLength = 0;
  let runStart: Date | null = null;
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    if (activeDays.has(dayKey(cursor))) {
      if (runLength === 0) runStart = new Date(cursor);
      runLength++;
      if (runLength > longestStreak) {
        longestStreak = runLength;
        longestStart = runStart ? new Date(runStart) : null;
        longestEnd = new Date(cursor);
      }
    } else {
      runLength = 0;
      runStart = null;
    }
  }

  const dateLabel = (date: Date) =>
    date.toLocaleDateString("en", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  const currentPeriod =
    currentStart && streakAnchor
      ? `${dateLabel(currentStart)} – ${dateLabel(streakAnchor)}`
      : "No current streak";
  const longestPeriod =
    longestStart && longestEnd
      ? `${dateLabel(longestStart)} – ${dateLabel(longestEnd)}`
      : "No active days in this period";
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 170" role="img" aria-labelledby="title desc">
<title id="title">Linked-email commit totals and streaks</title>
<desc id="desc">${total} commits from ${startDate} through ${endDate}. Current streak: ${currentStreak} days. Longest streak: ${longestStreak} days.</desc>
<style>text{font-family:Arial,sans-serif;fill:#24292f}.value{font-size:38px;font-weight:700}.label{font-size:16px}.detail{font-size:13px;fill:#57606a}.accent{fill:#fb8500}</style>
<line x1="300" y1="18" x2="300" y2="152" stroke="#d8dee4"/><line x1="600" y1="18" x2="600" y2="152" stroke="#d8dee4"/>
<text x="150" y="70" text-anchor="middle" class="value">${total.toLocaleString("en")}</text>
<text x="150" y="101" text-anchor="middle" class="label">Email-linked commits</text>
<text x="150" y="128" text-anchor="middle" class="detail">${dateLabel(start)} – ${dateLabel(end)}</text>
<text x="450" y="70" text-anchor="middle" class="value accent">${currentStreak}</text>
<text x="450" y="101" text-anchor="middle" class="label accent">Current streak</text>
<text x="450" y="128" text-anchor="middle" class="detail">${currentPeriod}</text>
<text x="750" y="70" text-anchor="middle" class="value">${longestStreak}</text>
<text x="750" y="101" text-anchor="middle" class="label">Longest streak</text>
<text x="750" y="128" text-anchor="middle" class="detail">${longestPeriod}</text>
</svg>`;
}

async function generateEmailContributionCalendar(): Promise<number> {
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error("GH_TOKEN is required to search commit author emails.");

  const commits = new Map<string, string>();
  for (const email of CONTRIBUTION_EMAILS) {
    await fetchEmailCommits(email, CONTRIBUTION_START, CONTRIBUTION_END, token, commits);
  }

  mkdirSync("assets", { recursive: true });
  writeFileSync(
    "assets/email-contributions.svg",
    renderContributionCalendar(commits, CONTRIBUTION_START, CONTRIBUTION_END)
  );
  writeFileSync(
    "assets/email-contribution-stats.svg",
    renderContributionStats(commits, CONTRIBUTION_START, CONTRIBUTION_END)
  );
  return commits.size;
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

### Email-linked Commit Stats

<div align="center">
<img alt="Rolling 12-month statistics for commits authored with linked email addresses" src="assets/email-contribution-stats.svg" width="100%" />
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

#### Commits by linked email

<img alt="Commits authored with linked email addresses over the last 12 months" src="assets/email-contributions.svg" width="100%" />
</div>
`;

const emailCommitCount = await generateEmailContributionCalendar();
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
  `Generated README.md with ${personalCount} personal and ${orgCount} org repos; ${emailCommitCount} email-matched commits from ${CONTRIBUTION_START} to ${CONTRIBUTION_END}`
);
