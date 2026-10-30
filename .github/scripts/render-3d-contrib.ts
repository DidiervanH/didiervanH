import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

// Renders yoshi389111/github-profile-3d-contrib's 3D calendar with the
// linked-email commit counts written by generate-readme.ts, instead of
// GitHub's own contribution calendar.
const OWNER = "DidiervanH";
const MAX_REPOS = 100;

interface EmailCommitDays {
  start: string;
  end: string;
  counts: Record<string, number>;
}

const libDir = process.argv[2];
if (!libDir) throw new Error("Usage: bun render-3d-contrib.ts <path-to-github-profile-3d-contrib>");
const token = process.env.GH_TOKEN;
if (!token) throw new Error("GH_TOKEN is required to fetch the profile data.");

const lib = (file: string) => import(resolve(libDir, "src", file));
const [client, aggregate, template, create] = await Promise.all([
  lib("github-graphql.ts"),
  lib("aggregate-user-info.ts"),
  lib("color-template.ts"),
  lib("create-svg.ts"),
]);

const { start, end, counts }: EmailCommitDays = JSON.parse(
  readFileSync("assets/email-commit-days.json", "utf8")
);

// GitHub's quartile levels: split the non-zero days into four equal groups.
const activeCounts = Object.values(counts)
  .filter((count) => count > 0)
  .sort((a, b) => a - b);
const quartiles = [1, 2, 3].map(
  (q) => activeCounts[Math.ceil((q / 4) * activeCounts.length) - 1] ?? 0
);
const levelFor = (count: number) =>
  count === 0 ? 0 : 1 + quartiles.filter((threshold) => count > threshold).length;

// The library places days by week offset from the first entry, so the
// calendar must start on a Sunday, like GitHub's does.
const calendar = [];
const cursor = new Date(`${start}T00:00:00Z`);
cursor.setUTCDate(cursor.getUTCDate() - cursor.getUTCDay());
for (const last = new Date(`${end}T00:00:00Z`); cursor <= last; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
  const date = cursor.toISOString().slice(0, 10);
  const contributionCount = date >= start ? counts[date] ?? 0 : 0;
  calendar.push({
    date: new Date(cursor),
    contributionCount,
    contributionLevel: levelFor(contributionCount),
  });
}

const userInfo = aggregate.aggregateUserInfo(await client.fetchData(token, OWNER, MAX_REPOS));
const emailCommitTotal = Object.values(counts).reduce((sum, count) => sum + count, 0);
// The language pie draws (total commits - language commits) as "other", so
// scale language counts to keep GitHub's proportions at the larger total.
const languageScale = emailCommitTotal / Math.max(1, userInfo.totalCommitContributions);
for (const language of userInfo.contributesLanguage) {
  language.contributions = Math.round(language.contributions * languageScale);
}
userInfo.contributionCalendar = calendar;
userInfo.totalCommitContributions = emailCommitTotal;
userInfo.totalContributions =
  emailCommitTotal +
  userInfo.totalIssueContributions +
  userInfo.totalPullRequestContributions +
  userInfo.totalPullRequestReviewContributions +
  userInfo.totalRepositoryContributions;

const settings = userInfo.isHalloween ? template.HalloweenSettings : template.NormalSettings;
mkdirSync("assets", { recursive: true });
writeFileSync("assets/profile-green-animate.svg", create.createSvg(userInfo, settings, true));
writeFileSync("assets/profile-night-view.svg", create.createSvg(userInfo, template.NightViewSettings, true));
console.log(
  `Rendered 3D contribution calendar with ${emailCommitTotal} email-matched commits (${userInfo.totalContributions} contributions)`
);
