// Curated "Playbook" use cases mirrored from the public playbook at
// https://www.open-hive.com/playbook. Surfaced as the leading section on the
// New Chat page so the recipes featured on the marketing site are the first
// thing a new user sees. Order here matches the playbook page top-to-bottom:
// Growth & Sales → Operations → Support & CX → Finance → Research.
import type { Prompt } from "./prompts";

export const playbookPrompts: Prompt[] = [
  // Growth & Sales
  { id: 9001, title: "Outbound BDR", category: "sales", content: "You're an outbound BDR. Pull 200 ICP leads, draft a tailored opener for each, route replies to my inbox, and log every touch to my CRM." },
  { id: 9002, title: "ICP Connection Scanner", category: "sales", content: "Scan my LinkedIn connections in batches and identify solo founders and startup builders that match my ideal customer profile. Log each match with the reason it fits." },
  { id: 9003, title: "Post Engagement Mining", category: "sales", content: "Find the people engaging with my LinkedIn posts and log them as pre-qualified prospects who are already interested in my offering." },
  { id: 9004, title: "Pending Connection Campaign", category: "sales", content: "Message my pending LinkedIn connection requests with personalized, multi-paragraph notes that reference something specific about each person." },
  { id: 9005, title: "ICP DM Campaign", category: "sales", content: "Work through my LinkedIn connections in batches, messaging founders and indie hackers I haven't pitched yet with a tailored first touch." },
  { id: 9006, title: "Prospect Profile Builder", category: "sales", content: "Enrich the prospects I've contacted with company size, tech stack, funding stage, and a verified work email." },
  { id: 9007, title: "CRM Pipeline Status", category: "sales", content: "Push my outreach touches and replies to HubSpot or Salesforce in real time, with automated tagging by stage and intent." },
  { id: 9008, title: "Daily Outreach Automation", category: "sales", content: "Schedule daily outreach batches at human-looking times, back off automatically on friction signals, and notify me on Slack the moment someone replies." },
  { id: 9009, title: "Lead Enricher", category: "sales", content: "Enrich a CSV of 500 companies with firmographics, tech stack, and funding signals, then hand it back ready for outreach." },
  { id: 9010, title: "Competitor Monitor", category: "sales", content: "Track 10 competitors across product launches, pricing changes, and reviews, and send me a weekly diff of what changed." },
  { id: 9011, title: "Pre-call Prospect Researcher", category: "sales", content: "Generate meeting prep for my next call: a short bio, recent posts, mutual connections, and two or three warm openers." },
  { id: 9012, title: "Lead Generation", category: "sales", content: "Search Google Maps, LinkedIn, job boards, and Shopify in parallel for fresh leads that match my ICP, and return them enriched and deduped." },
  // Operations
  { id: 9013, title: "Ops Triage", category: "operations", content: "Watch PagerDuty, Jira, and Zendesk, cluster related incidents together, and suggest fixes to whoever is on-call." },
  { id: 9014, title: "Inbox Triage", category: "operations", content: "Classify incoming support intent, auto-reply to FAQs, and escalate the complex tickets with drafted context attached." },
  { id: 9015, title: "On-call Summarizer", category: "operations", content: "Deliver a weekly Monday digest of the past week's alerts, retros, and still-unresolved threads." },
  { id: 9016, title: "Vendor Portal Roll-up", category: "operations", content: "Pull reports from my 6 vendor portals nightly, normalize and dedupe the data, and alert me when something breaks." },
  { id: 9017, title: "PR Window Watcher", category: "operations", content: "Summarize what changed in the GitHub PR queue and ping the right reviewers when a PR has been waiting too long." },
  // Support & CX
  { id: 9018, title: "Ticket Router", category: "support", content: "Classify support intent, auto-reply to FAQs, and escalate complex issues in Zendesk or Intercom with context the agent needs." },
  { id: 9019, title: "NPS Diary", category: "support", content: "Cluster each week's NPS comments into themes and route the insights to the owner best placed to act on them." },
  { id: 9020, title: "Onboarding Concierge", category: "support", content: "Detect users who are stuck during onboarding and intervene with a tailored nudge, or hand them to a human when needed." },
  { id: 9021, title: "Review Replier", category: "support", content: "Draft thoughtful replies to App Store, Google, and G2 reviews and queue them for my approval before posting." },
  // Finance
  { id: 9022, title: "Invoice Reconciler", category: "finance", content: "Match incoming invoices to vendors, flag anomalies, and post to the general ledger with a short explanation for each entry." },
  { id: 9023, title: "Expense Anomaly Hunter", category: "finance", content: "Monitor the corporate-card feed for policy outliers, broken down by employee and merchant, and surface the ones worth reviewing." },
  { id: 9024, title: "Cash-flow Forecaster", category: "finance", content: "Roll AR, AP, and recurring revenue into a 13-week cash-flow forecast and update it daily." },
  { id: 9025, title: "Board-pack Compiler", category: "finance", content: "Pull this month's KPIs from our BI tools, populate the board template, and write the commentary." },
  // Research
  { id: 9026, title: "Research Desk", category: "marketing", content: "Monitor 40 sources every day and deliver a cited 200-word brief in my inbox by 7am." },
  { id: 9027, title: "Morning Brief", category: "marketing", content: "Give me a daily 7am briefing with three highlights and clickable links, pulled from 40+ sources I care about." },
  { id: 9028, title: "Profile Builder", category: "marketing", content: "Generate a structured dossier on a person: career arc, talks, interests, and their recent moves." },
  { id: 9029, title: "Market Sizing Workbook", category: "marketing", content: "Produce a sourced TAM/SAM/SOM analysis from filings, papers, and analyst reports, with every number cited." },
  { id: 9030, title: "Subreddit Sentiment", category: "marketing", content: "Monitor 400 subreddits for ICP intent signals and draft ready-to-send DMs for the strongest ones." },
];
