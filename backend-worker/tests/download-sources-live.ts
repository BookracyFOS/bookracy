// Live smoke test for the three download sources, mirroring the Worker's resolver
// logic against real upstreams and asserting we get actual file bytes (not an HTML
// wall). Network + availability dependent — a single source failing is not fatal (it
// may be blocked from your local network / unpinned on IPFS); it fails only if EVERY
// source misses. Sources resolve differently from Cloudflare's edge than from a home
// ISP, so treat this as a signal, not gospel. Run:
//   npx tsx tests/download-sources-live.ts [md5]
import { parseLibgenUrl, parseLibraryLolUrl, parseIpfsCids } from "../src/parse";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const H = { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*;q=0.8" };

const LIBGEN_MIRRORS = ["https://libgen.li", "https://libgen.la", "https://libgen.gl", "https://libgen.vg", "https://libgen.bz"];
const LIBGEN_RS_HOSTS = ["https://library.lol", "https://books.ms"];
const AA_MIRRORS = ["https://annas-archive.gl", "https://annas-archive.pk", "https://annas-archive.gd"];
const IPFS_GATEWAYS = ["https://ipfs.io/ipfs", "https://dweb.link/ipfs", "https://trustless-gateway.link/ipfs", "https://w3s.link/ipfs"];

let passes = 0;
const report = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "····"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (ok) passes++;
};

const timed = async (url: string, ms: number, headers = H): Promise<Response | null> => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { headers, signal: ctrl.signal, redirect: "follow" });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
};

// A real file response: OK, not text/html. We peek the first bytes to be sure.
const isRealFile = async (resp: Response | null): Promise<boolean> => {
  if (!resp || !resp.ok || !resp.body) return false;
  if ((resp.headers.get("Content-Type") || "").toLowerCase().includes("text/html")) {
    await resp.body.cancel().catch(() => {});
    return false;
  }
  const reader = resp.body.getReader();
  const { value } = await reader.read();
  await reader.cancel().catch(() => {});
  if (!value || value.length < 4) return false;
  const head = new TextDecoder("latin1").decode(value.slice(0, 5));
  // Not an HTML page masquerading with the wrong content-type.
  return !/^\s*<(!doc|html|\?xml)/i.test(head);
};

async function getMd5(): Promise<string> {
  const arg = process.argv[2];
  if (arg && /^[a-f0-9]{32}$/i.test(arg)) return arg.toLowerCase();
  // Grab a live md5 off libgen.li search so the smoke test is self-contained.
  const resp = await timed(`https://libgen.li/index.php?req=pride+and+prejudice`, 25000);
  const html = resp ? await resp.text() : "";
  const m = html.match(/ads\.php\?md5=([a-f0-9]{32})/i);
  if (!m) throw new Error("could not obtain a sample md5 from libgen.li");
  return m[1].toLowerCase();
}

async function main() {
  const md5 = await getMd5();
  console.log(`\nSmoke-testing md5 ${md5}\n`);

  // Source 1: libgen.li family.
  let s1 = false;
  for (const base of LIBGEN_MIRRORS) {
    const page = await timed(`${base}/ads.php?md5=${md5}`, 15000);
    const url = page && page.ok ? parseLibgenUrl(await page.text(), base) : null;
    if (!url) continue;
    if (await isRealFile(await timed(url, 25000, { ...H, Referer: `${base}/` }))) {
      report("Source 1 libgen.li family", true, base);
      s1 = true;
      break;
    }
  }
  if (!s1) report("Source 1 libgen.li family", false, "no mirror served bytes (may be network-blocked here)");

  // Source 2: libgen.rs fork (library.lol / books.ms).
  let s2 = false;
  outer2: for (const host of LIBGEN_RS_HOSTS) {
    for (const type of ["main", "fiction"]) {
      const page = await timed(`${host}/${type}/${md5}`, 12000);
      const url = page && page.ok ? parseLibraryLolUrl(await page.text(), host) : null;
      if (!url) continue;
      if (await isRealFile(await timed(url, 25000, { ...H, Referer: `${host}/` }))) {
        report("Source 2 libgen.rs fork", true, `${host}/${type}`);
        s2 = true;
        break outer2;
      }
    }
  }
  if (!s2) report("Source 2 libgen.rs fork", false, "no host served bytes (often ISP-blocked locally; try from the edge)");

  // Source 3: IPFS (CIDs from the AA md5 page -> public gateways).
  let s3 = false;
  let cids: string[] = [];
  for (const base of AA_MIRRORS) {
    const page = await timed(`${base}/md5/${md5}`, 12000);
    if (page && page.ok) {
      cids = parseIpfsCids(await page.text());
      if (cids.length) break;
    }
  }
  if (cids.length) {
    outer3: for (const cid of cids) {
      for (const gw of IPFS_GATEWAYS) {
        if (await isRealFile(await timed(`${gw}/${cid}`, 25000, H))) {
          report("Source 3 IPFS", true, `${gw} (${cid.slice(0, 12)}…)`);
          s3 = true;
          break outer3;
        }
      }
    }
    if (!s3) report("Source 3 IPFS", false, `${cids.length} CID(s) found but no gateway served them (unpinned)`);
  } else {
    report("Source 3 IPFS", false, "no IPFS CID on the AA page for this md5");
  }

  const anyOk = passes > 0;
  console.log(`\n${passes}/3 sources served real bytes.${anyOk ? "" : " ALL sources missed — investigate."}`);
  process.exit(anyOk ? 0 : 1);
}

main().catch((e) => {
  console.error("smoke test error:", e);
  process.exit(1);
});
