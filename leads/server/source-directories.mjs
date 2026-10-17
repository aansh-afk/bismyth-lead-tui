// Deterministic adapters for explicit membership layouts. No model or network calls.
export function directoryContacts(value, extract, dialCode) {
  let url;
  try {
    url = new URL(
      value.url || value.metadata?.sourceURL || value.metadata?.url,
    );
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "");
  if (!["areagroup.in", "reaak.com"].includes(host)) return null;
  const body =
    typeof value.markdown === "string" ? value.markdown.slice(0, 150000) : "";
  const records = [];
  const add = (
    block,
    {
      name = "",
      role = "",
      company = "",
      kind = "person",
      company_evidence = "",
    } = {},
  ) => {
    const ids = extract(block, [], dialCode);
    const base = {
      name,
      role,
      company,
      kind,
      company_website: "",
      company_evidence,
      evidence: block.slice(0, 1200),
      email: ids.emails[0] || "",
    };
    if (ids.candidates.length)
      for (const c of ids.candidates) records.push({ ...base, phone: c.phone });
    else if (name || ids.emails.length) records.push({ ...base, phone: "" });
  };
  if (host === "areagroup.in") {
    const footer = /^## Get in touch\s*$/im.exec(body);
    const main = body.slice(0, footer?.index ?? body.length);
    const heading = /^# ([^\n]+)$/m.exec(main);
    const company = heading?.[1].trim() || "";
    if (/^\/groupmember\//.test(url.pathname) && company) {
      const section = main.slice(heading.index);
      // Main named proprietor before the member list, with their own contact block.
      const owner =
        /^## ([^\n]+)\n+\s*(Proprietor|Owner|Partner|Managing Director|Managing Partner|CEO|Director|Founder|Co-founder)\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/gim;
      for (const match of section.matchAll(owner))
        add(match[0], {
          name: match[1].trim(),
          role: match[2].trim(),
          company,
          company_evidence: heading[0],
        });
      const members = [...section.matchAll(/^-\s*Name\s*:?\s*([^\n]+)\n/gim)];
      for (let i = 0; i < members.length; i++) {
        const match = members[i],
          block = section
            .slice(match.index, members[i + 1]?.index ?? section.length)
            .trim();
        const role =
          /^-\s*Role\s*:?\s*([^\n]+)/im.exec(block)?.[1].trim() || "";
        add(block, {
          name: match[1].trim(),
          role,
          company,
          company_evidence: heading[0],
        });
      }
    }
    if (/^\/our-members(?:\/|$)/.test(url.pathname)) {
      let previous = 0;
      for (const detail of main.matchAll(
        /\[View Details\]\((https?:\/\/(?:www\.)?areagroup\.in\/groupmember\/[^)]+)\)/g,
      )) {
        const chunk = main.slice(previous, detail.index);
        previous = detail.index + detail[0].length;
        const headings = [...chunk.matchAll(/^## ([^\n]+)$/gm)].filter(
          (h) => h[1].trim() !== "Our Members",
        );
        if (headings.length < 2) continue;
        const firm = headings.at(-2),
          person = headings.at(-1);
        const role = chunk
          .slice(person.index + person[0].length)
          .trim()
          .split("\n")[0]
          .trim();
        if (
          !/^(?:Proprietor|Owner|Partner|Managing Director|Managing Partner|CEO|Director|Founder|Co-founder)$/i.test(
            role,
          )
        )
          continue;
        const start = records.length;
        add(chunk.slice(firm.index).trim(), {
          name: person[1].trim(),
          role,
          company: firm[1].trim(),
          company_evidence: firm[0],
        });
        for (const record of records.slice(start))
          record.profile_url = detail[1];
      }
    }
    if (footer) {
      const block = body.slice(footer.index).split(/^## about us/im)[0];
      add(block, {
        company: "AREA Group",
        kind: "site_contact",
        company_evidence: "Website-wide Get in touch section on areagroup.in",
      });
    }
    // Non-member pages may contain other unassigned identifiers. Keep them as site research.
    const seen = new Set(records.map((c) => c.phone).filter(Boolean));
    for (const c of extract(
      body,
      Array.isArray(value.links) ? value.links : [],
      dialCode,
    ).candidates)
      if (!seen.has(c.phone))
        records.push({
          ...c,
          name: "",
          role: "",
          company: /^\/(?:our-members|groupmember)(?:\/|$)/.test(url.pathname)
            ? ""
            : "AREA Group",
          company_website: "",
          email: "",
          kind: /^\/(?:our-members|groupmember)(?:\/|$)/.test(url.pathname)
            ? "unknown"
            : "site_contact",
        });
  } else {
    for (const match of body.matchAll(
      /^([^\n]+?)\s+\((?:MR\.?|MRS\.?|MS\.?)\s+([^\n]+)\)\s*$/gim,
    ))
      add(match[0], {
        name: match[2].trim(),
        company: match[1].trim(),
        company_evidence: match[0],
      });
    for (const c of extract(
      body,
      Array.isArray(value.links) ? value.links : [],
      dialCode,
    ).candidates)
      records.push({
        ...c,
        name: "",
        role: "",
        company: host,
        company_website: "",
        email: "",
        kind: "site_contact",
      });
  }
  return records.length
    ? {
        candidates: records.slice(0, 1000),
        emails: extract(body, [], dialCode).emails,
      }
    : null;
}
