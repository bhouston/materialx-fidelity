export interface RendererMetadata {
  rendererName: string;
  packageName: string;
  packageUrl: string;
  observerDescription: string;
}

const RENDERER_METADATA_BY_NAME: Record<string, RendererMetadata> = {
  blender: {
    rendererName: 'blender',
    packageName: '@material-fidelity/renderer-blender',
    packageUrl: 'https://github.com/bhouston/material-fidelity/tree/main/packages/renderer-blender',
    observerDescription: "Custom MaterialX loader for Blender Cycles",
  },
  'blender-io-mtlx': {
    rendererName: 'blender-io-mtlx',
    packageName: '@material-fidelity/renderer-blender',
    packageUrl: 'https://github.com/bhouston/material-fidelity/tree/main/packages/renderer-blender',
    observerDescription: 'io_blender_mtlx MaterialX add-on rendered through Blender Cycles',
  },
  materialxview: {
    rendererName: 'materialxview',
    packageName: '@material-fidelity/renderer-materialxview',
    packageUrl: 'https://github.com/bhouston/material-fidelity/tree/main/packages/renderer-materialxview',
    observerDescription: 'Reference viewer from the MaterialX project',
  },
  'threejs-current': {
    rendererName: 'threejs-current',
    packageName: '@material-fidelity/renderer-threejs',
    packageUrl: 'https://github.com/bhouston/material-fidelity/tree/main/packages/renderer-threejs',
    observerDescription: 'Built-in Three.js MaterialX loader',
  },
  'threejs-new': {
    rendererName: 'threejs-new',
    packageName: '@material-fidelity/renderer-threejs',
    packageUrl: 'https://github.com/bhouston/material-fidelity/tree/main/packages/renderer-threejs',
    observerDescription: 'Experimental MaterialX loader',
  },
  materialxjs: {
    rendererName: 'materialxjs',
    packageName: '@material-fidelity/renderer-materialxjs',
    packageUrl: 'https://github.com/bhouston/material-fidelity/tree/main/packages/renderer-materialxjs',
    observerDescription: 'Experimental MaterialX loader project',
  },
};

export function getRendererMetadata(rendererName: string): RendererMetadata | undefined {
  return RENDERER_METADATA_BY_NAME[rendererName];
}
