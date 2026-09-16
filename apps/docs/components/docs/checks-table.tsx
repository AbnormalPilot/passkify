import stats from '@/lib/generated/stats.json';

/**
 * A ceremony's verification checks, rendered from the generated registry.
 *
 * These tables used to be written out in the MDX. Both had fallen behind the
 * verifier — registration listed fifteen rows against eighteen real checks —
 * which is the failure mode the check registry exists to prevent, reintroduced
 * by transcribing it. The count in the caption is `rows.length`, so a table
 * that says eighteen has eighteen.
 *
 * `scripts/build-content.mjs` expands the same tag into a markdown table for
 * /llms.txt and the raw `.md` routes, so the agent-facing corpus and the page
 * cannot disagree either.
 */
export function ChecksTable({ ceremony }: { ceremony: 'registration' | 'authentication' }) {
  const rows = stats.checkList[ceremony];
  const section = ceremony === 'registration' ? '§7.1' : '§7.2';

  return (
    <div className="table-wrap">
      <table>
        <caption className="t-mono-caps mb-md text-left text-graphite">
          {rows.length} checks, in WebAuthn {section} order
        </caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Check</th>
            <th scope="col">Failure code</th>
            <th scope="col">Specification</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((check) => (
            <tr key={check.id}>
              <td>{check.index}</td>
              <td>{check.title}</td>
              <td>
                <code>{check.code}</code>
              </td>
              <td>{check.spec}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
