import { useSuspenseQuery } from '@tanstack/react-query';
import { Component, Suspense } from 'react';
import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '#/components/ui/dialog';

export interface ActiveMaterialSourceState {
  materialName: string;
  materialSourceUrl: string;
}

interface MaterialSourceDialogProps {
  material: ActiveMaterialSourceState;
  onClose: () => void;
}

interface MaterialSourceErrorBoundaryProps {
  children: ReactNode;
  fallback: (error: Error) => ReactNode;
}

interface MaterialSourceErrorBoundaryState {
  error: Error | null;
}

class MaterialSourceErrorBoundary extends Component<
  MaterialSourceErrorBoundaryProps,
  MaterialSourceErrorBoundaryState
> {
  declare state: MaterialSourceErrorBoundaryState;

  constructor(props: MaterialSourceErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): MaterialSourceErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return this.props.fallback(this.state.error);
    }

    return this.props.children;
  }
}

function MaterialSourceDialogContent({ materialSourceUrl }: { materialSourceUrl: string }) {
  const { data } = useSuspenseQuery({
    queryKey: ['material-source', materialSourceUrl],
    queryFn: async () => {
      const response = await fetch(materialSourceUrl);
      if (!response.ok) {
        throw new Error('Material source not found.');
      }
      return response.text();
    },
  });

  return (
    <div className="max-h-[65vh] overflow-auto rounded-md border border-border bg-muted/10 p-3">
      <pre className="min-w-max whitespace-pre font-mono text-xs leading-5 text-foreground">{data}</pre>
    </div>
  );
}

function MaterialSourceLoadingState() {
  return <p className="text-muted-foreground">Loading material source...</p>;
}

function MaterialSourceErrorState({ error }: { error: Error }) {
  return (
    <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">
      {error.message}
    </p>
  );
}

export function MaterialSourceDialog({ material, onClose }: MaterialSourceDialogProps) {
  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto p-0">
        <DialogHeader className="sticky top-0 z-10 border-b border-border bg-background/95 px-5 py-4 backdrop-blur">
          <DialogTitle>Material source</DialogTitle>
          <DialogDescription>{material.materialName}</DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4 text-sm">
          <MaterialSourceErrorBoundary
            key={material.materialSourceUrl}
            fallback={(error) => <MaterialSourceErrorState error={error} />}
          >
            <Suspense fallback={<MaterialSourceLoadingState />}>
              <MaterialSourceDialogContent materialSourceUrl={material.materialSourceUrl} />
            </Suspense>
          </MaterialSourceErrorBoundary>
        </div>
      </DialogContent>
    </Dialog>
  );
}
