import { Link } from '@tanstack/react-router';
import { Github } from 'lucide-react';

export default function Header() {
  return (
    <header className="border-b border-border bg-card py-3 shadow-sm">
      <div className="mx-auto flex w-full max-w-[1120px] items-center gap-3 px-4 sm:px-6">
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
          className="text-xl font-semibold text-foreground no-underline"
          search={(prev) => ({ materials: prev.materials, surfaces: prev.surfaces })}
          to="/"
        >
          Ben's MaterialX Fidelity Test Suite
        </Link>
        <nav className="ml-auto flex items-center gap-4">
          <a
            aria-label="Ben's MaterialX Fidelity Testing repository"
            className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            href="https://github.com/bhouston/material-fidelityTesting"
            rel="noopener noreferrer"
            target="_blank"
          >
            <Github className="size-4" />
            <span>GitHub</span>
          </a>
        </nav>
      </div>
    </header>
  );
}
