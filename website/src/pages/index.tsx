import { useMemo, useState, type ReactNode } from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import clsx from 'clsx';

import catalogue from '@site/src/data/catalogue.json';
import styles from './index.module.css';

interface CatalogueEntry {
  id: string;
  displayName: string;
  description: string;
  repository: string;
  artifact: string;
  publisher?: string;
  category?: string;
  tags?: string[];
  license?: string;
  version: string;
  resourceCount: number;
}

const entries = catalogue as CatalogueEntry[];

const ALL = 'All';

function ExtensionCard({ entry }: { entry: CatalogueEntry }): ReactNode {
  return (
    <Link className={styles.card} to={`/docs/extensions/${entry.id}`}>
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>{entry.displayName}</h3>
        <span className={styles.version}>{entry.version}</span>
      </div>
      <p className={styles.cardDescription}>{entry.description}</p>
      <div className={styles.cardFooter}>
        <span className={styles.resourceCount}>
          {entry.resourceCount} resource type{entry.resourceCount === 1 ? '' : 's'}
        </span>
        {entry.category && <span className={styles.category}>{entry.category}</span>}
      </div>
    </Link>
  );
}

export default function Home(): ReactNode {
  const { siteConfig } = useDocusaurusContext();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(ALL);

  const categories = useMemo(() => {
    const unique = new Set(entries.map(entry => entry.category).filter(Boolean) as string[]);
    return [ALL, ...Array.from(unique).sort()];
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries
      .filter(entry => category === ALL || entry.category === category)
      .filter(entry => {
        if (!needle) {
          return true;
        }
        const haystack = [entry.displayName, entry.description, entry.id, ...(entry.tags ?? [])]
          .join(' ')
          .toLowerCase();
        return haystack.includes(needle);
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [query, category]);

  const totalResources = entries.reduce((total, entry) => total + entry.resourceCount, 0);

  return (
    <Layout title="Catalogue" description={siteConfig.tagline}>
      <main className="container margin-vert--lg">
        <div className={styles.intro}>
          <h1 className={styles.title}>Bicep Extensions</h1>
          <p className={styles.tagline}>
            {siteConfig.tagline}. <Link to="/docs/guides/getting-started">Getting started</Link>{' '}
            explains how to install and use them.
          </p>
        </div>

        <div className={styles.controls}>
          <input
            className={styles.search}
            type="search"
            placeholder="Search extensions…"
            value={query}
            onChange={event => setQuery(event.target.value)}
            aria-label="Search extensions"
          />
          <div className={styles.filters} role="group" aria-label="Filter by category">
            {categories.map(item => (
              <button
                key={item}
                type="button"
                className={clsx(styles.filter, category === item && styles.filterActive)}
                onClick={() => setCategory(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className={styles.empty}>No extensions match your search.</p>
        ) : (
          <div className={styles.grid}>
            {filtered.map(entry => (
              <ExtensionCard key={entry.id} entry={entry} />
            ))}
          </div>
        )}

        <p className={styles.summary}>
          {entries.length} extensions, {totalResources} resource types.
        </p>
      </main>
    </Layout>
  );
}
