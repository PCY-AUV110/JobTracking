export const JOB_FUNCTIONS = [
  "business_analysis", "operations", "public_affairs", "market_research",
  "marketing", "sales", "finance", "data_analysis", "consulting", "hr",
  "supply_chain", "product",
] as const;

export type JobFunction = typeof JOB_FUNCTIONS[number];

// Keep the ordered precedence aligned with migration 0006. Specific ambiguous
// titles must be tested before broader categories.
export const JOB_FUNCTION_RULES: ReadonlyArray<readonly [JobFunction, RegExp]> = [
  ["data_analysis", /\b(?:data (?:analyst|analytics|analysis|science)|business intelligence|bi analyst)\b/i],
  ["sales", /\b(?:business development|account executive|sales|revenue|partnerships?)\b/i],
  ["business_analysis", /\b(?:business (?:analyst|analysis|analytics)|strategy analyst|process analyst)\b/i],
  ["public_affairs", /\b(?:public affairs?|government (?:affairs?|relations?)|policy|regulatory|advocacy|legislative)\b/i],
  ["market_research", /\b(?:market research|consumer insights?|customer insights?|research analyst)\b/i],
  ["supply_chain", /\b(?:supply chain|procurement|sourcing|logistics|inventory|distribution)\b/i],
  ["hr", /\b(?:human resources?|people (?:operations?|partner)|talent acquisition|recruit(?:er|ing)|hr)\b/i],
  ["consulting", /\b(?:consult(?:ant|ing)|advisory)\b/i],
  ["product", /\b(?:product (?:manager|management|operations?|analyst|marketing)|product owner)\b/i],
  ["finance", /\b(?:finance|financial|accounting|accountant|audit|treasury|tax)\b/i],
  ["marketing", /\b(?:marketing|brand|communications?|growth|content|social media)\b/i],
  ["operations", /\b(?:operations?|operational|program (?:manager|management|coordinator)|project coordinator)\b/i],
];

export function classifyJobFunction(title: string): JobFunction | null {
  return JOB_FUNCTION_RULES.find(([, pattern]) => pattern.test(title))?.[0] ?? null;
}

const explicitFrench = /(?:^|[^a-zÀ-ÿ])(?:french|français|francais)(?=$|[^a-zÀ-ÿ])/iu;
const bilingual = /(?:^|[^a-zÀ-ÿ])(?:bilingual|bilingue)(?=$|[^a-zÀ-ÿ])/iu;

export function requiresFrench(countryCode: string, titleAndDescription: string): boolean {
  if (explicitFrench.test(titleAndDescription)) return true;
  return countryCode === "CA" && bilingual.test(titleAndDescription);
}
