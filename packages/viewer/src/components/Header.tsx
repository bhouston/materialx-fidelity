import { Link } from '@tanstack/react-router'
import { Github } from 'lucide-react'

export default function Header() {
  return (
    <header className="border-b border-border bg-card py-3 shadow-sm">
      <div className="mx-auto flex w-full max-w-[1120px] items-center gap-3 px-4 sm:px-6">
        <Link className="text-xl font-semibold text-foreground no-underline" search={{}} to="/">
          MaterialX Fidelity Viewer
        </Link>
        <nav className="ml-auto flex items-center gap-4">
          <a
            aria-label="MaterialX Fidelity Testing repository"
            className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            href="https://github.com/bhouston/MaterialX-FidelityTesting"
            rel="noopener noreferrer"
            target="_blank"
          >
            <Github className="size-4" />
            <span>GitHub</span>
          </a>
        </nav>
      </div>
    </header>
  )
}
