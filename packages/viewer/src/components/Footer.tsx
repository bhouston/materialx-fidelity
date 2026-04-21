export default function Footer() {
  return (
    <footer className="mt-auto border-t border-border bg-muted/30 py-4 text-sm text-muted-foreground">
      <div className="mx-auto w-full max-w-[1120px] px-4 text-center sm:px-6">
        Built with <span aria-hidden="true">♥</span> by{' '}
        <a
          className="underline transition-colors hover:text-foreground"
          href="https://ben3d.ca"
          rel="noopener noreferrer"
          target="_blank"
        >
          Ben Houston
        </a>
        . Sponsored by{' '}
        <a
          className="underline transition-colors hover:text-foreground"
          href="https://landofassets.com"
          rel="noopener noreferrer"
          target="_blank"
        >
          Land of Assets
        </a>
        .
      </div>
    </footer>
  )
}
