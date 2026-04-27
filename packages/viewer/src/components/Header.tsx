import { Link } from '@tanstack/react-router';
import { Github } from 'lucide-react';

import { SITE_NAME } from '#/lib/site-config';

interface HeaderProps {
  materialFilter: string;
  shownMaterialCount: number;
  totalMaterialCount: number;
  onMaterialFilterChange: (value: string) => void;
}

export default function Header({
  materialFilter,
  shownMaterialCount,
  totalMaterialCount,
  onMaterialFilterChange,
}: HeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-card/95 py-3 shadow-sm backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-2 px-4 sm:px-6 md:flex-row md:items-center">
        <div className="flex items-center gap-3">
          <a
            aria-label="MaterialX project"
            className="shrink-0"
            href="https://materialx.org/"
            rel="noopener noreferrer"
            target="_blank"
          >
            <img alt="MaterialX logo" className="size-7" src="/materialx-logo.svg" />
          </a>
          <Link
            className="text-base font-semibold text-foreground no-underline sm:text-xl"
            search={(prev) => ({ materials: prev.materials })}
            to="/"
          >
            {SITE_NAME}
          </Link>
          <a
            aria-label="MaterialX Fidelity Testing repository"
            className="ml-auto inline-flex items-center text-muted-foreground transition-colors hover:text-foreground md:hidden"
            href="https://github.com/bhouston/material-fidelity"
            rel="noopener noreferrer"
            target="_blank"
          >
            <Github className="size-4" />
          </a>
        </div>

        <div className="flex items-center gap-2 md:ml-auto">
          <input
            className="h-9 w-full min-w-0 rounded-none border border-border bg-background px-3 text-sm text-foreground shadow-xs outline-none transition-colors placeholder:text-muted-foreground focus:border-primary md:w-80"
            onChange={(event) => onMaterialFilterChange(event.currentTarget.value)}
            placeholder="Material Filter"
            type="text"
            value={materialFilter}
          />
          <span className="shrink-0 text-sm text-muted-foreground">
            {shownMaterialCount}/{totalMaterialCount}
          </span>
          <a
            aria-label="MaterialX Fidelity Testing repository"
            className="ml-1 hidden items-center text-muted-foreground transition-colors hover:text-foreground md:inline-flex"
            href="https://github.com/bhouston/material-fidelity"
            rel="noopener noreferrer"
            target="_blank"
          >
            <Github className="size-4" />
          </a>
        </div>
      </div>
    </header>
  );
}
