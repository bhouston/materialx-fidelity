import {
	Texture, RepeatWrapping, ImageBitmapLoader,
	MeshBasicNodeMaterial, MeshPhysicalNodeMaterial
} from 'three/webgpu';

import {
	float, bool, int, vec2, vec3, vec4, color, texture,
	positionLocal, positionWorld, uv, vertexColor,
	normalLocal, normalWorld, tangentLocal, tangentWorld,
	mul, element, mx_transform_uv,
	mx_srgb_texture_to_lin_rec709
} from 'three/tsl';

import { MaterialXSurfaceMappings } from './MaterialXSurfaceMappings.js';
import { MtlXLibrary } from './MaterialXNodeLibrary.js';

const colorSpaceLib = {
	mx_srgb_texture_to_lin_rec709
};

function getOutputChannel( outputName ) {
	if ( outputName === 'outx' || outputName === 'outr' || outputName === 'r' ) return 0;
	if ( outputName === 'outy' || outputName === 'outg' || outputName === 'g' ) return 1;
	if ( outputName === 'outz' || outputName === 'outb' || outputName === 'b' ) return 2;
	if ( outputName === 'outw' || outputName === 'outa' || outputName === 'a' ) return 3;
	return 0;
}

class MaterialXNode {
	constructor( materialX, nodeXML, nodePath = '' ) {
		this.materialX = materialX;
		this.nodeXML = nodeXML;
		this.nodePath = nodePath ? nodePath + '/' + this.name : this.name;
		this.parent = null;
		this.node = null;
		this.children = [];
	}

	get element() { return this.nodeXML.nodeName; }
	get nodeGraph() { return this.getAttribute( 'nodegraph' ); }
	get nodeName() { return this.getAttribute( 'nodename' ); }
	get interfaceName() { return this.getAttribute( 'interfacename' ); }
	get output() { return this.getAttribute( 'output' ); }
	get name() { return this.getAttribute( 'name' ); }
	get type() { return this.getAttribute( 'type' ); }
	get value() { return this.getAttribute( 'value' ); }

	getNodeGraph() {
		let nodeX = this;
		while ( nodeX !== null ) {
			if ( nodeX.element === 'nodegraph' ) break;
			nodeX = nodeX.parent;
		}
		return nodeX;
	}

	getRoot() {
		let nodeX = this;
		while ( nodeX.parent !== null ) {
			nodeX = nodeX.parent;
		}
		return nodeX;
	}

	get referencePath() {
		let referencePath = null;
		if ( this.nodeGraph !== null && this.output !== null ) {
			referencePath = this.nodeGraph + '/' + this.output;
		} else if ( this.nodeName !== null || this.interfaceName !== null ) {
			const graphNode = this.getNodeGraph();
			if ( graphNode ) {
				referencePath = graphNode.nodePath + '/' + ( this.nodeName || this.interfaceName );
			}
		}
		return referencePath;
	}

	get hasReference() { return this.referencePath !== null; }
	get isConst() { return this.element === 'input' && this.value !== null && this.type !== 'filename'; }

	getColorSpaceNode() {
		const csSource = this.getAttribute( 'colorspace' );
		const csTarget = this.getRoot().getAttribute( 'colorspace' );
		if ( ! csSource || ! csTarget ) return null;
		const nodeName = `mx_${ csSource }_to_${ csTarget }`;
		return colorSpaceLib[ nodeName ] || null;
	}

	getTexture() {
		const filePrefix = this.getRecursiveAttribute( 'fileprefix' ) || '';
		const sourceURI = filePrefix + this.value;
		const resolvedURI = this.materialX.resolveTextureURI( sourceURI );

		if ( this.materialX.textureCache.has( resolvedURI ) ) {
			return this.materialX.textureCache.get( resolvedURI );
		}

		let loader = this.materialX.textureLoader;
		if ( resolvedURI ) {
			const handler = this.materialX.manager.getHandler( resolvedURI );
			if ( handler !== null ) loader = handler;
		}

		const textureNode = new Texture();
		textureNode.wrapS = textureNode.wrapT = RepeatWrapping;
		this.materialX.textureCache.set( resolvedURI, textureNode );

		loader.load( resolvedURI, function ( imageBitmap ) {
			textureNode.image = imageBitmap;
			textureNode.needsUpdate = true;
		}, undefined, () => {
			textureNode.needsUpdate = true;
		} );

		return textureNode;
	}

	getClassFromType( type ) {
		if ( type === 'integer' ) return int;
		if ( type === 'float' ) return float;
		if ( type === 'vector2' ) return vec2;
		if ( type === 'vector3' ) return vec3;
		if ( type === 'vector4' || type === 'color4' ) return vec4;
		if ( type === 'color3' ) return color;
		if ( type === 'boolean' ) return bool;
		return null;
	}

	getNode( out = null ) {
		let node = this.node;
		if ( node !== null && out === null ) return node;

		if ( this.element === 'input' && this.name === 'texcoord' && this.type === 'vector2' ) {
			let index = 0;
			const defaultGeomProp = this.getAttribute( 'defaultgeomprop' );
			if ( defaultGeomProp && /^UV(\d+)$/.test( defaultGeomProp ) ) {
				index = parseInt( defaultGeomProp.match( /^UV(\d+)$/ )[ 1 ], 10 );
			}
			node = uv( index );
		}

		if ( ( this.element === 'separate2' || this.element === 'separate3' || this.element === 'separate4' ) && out ) {
			const inNode = this.getNodeByName( 'in' );
			return element( inNode, getOutputChannel( out ) );
		}

		const type = this.type;

		if ( this.isConst ) {
			const nodeClass = this.getClassFromType( type );
			node = nodeClass ? nodeClass( ...this.getVector() ) : float( 0 );
		} else if ( this.hasReference ) {
			if ( this.element === 'output' && this.output && out === null ) out = this.output;
			const referenceNode = this.materialX.getMaterialXNode( this.referencePath );

			if ( referenceNode ) {
				node = referenceNode.getNode( out );
			} else {
				this.materialX.issueCollector.addMissingReference( this.name, this.referencePath );
				node = float( 0 );
			}
		} else {
			const elementName = this.element;

			if ( elementName === 'convert' ) {
				const nodeClass = this.getClassFromType( type ) || float;
				node = nodeClass( this.getNodeByName( 'in' ) );
			} else if ( elementName === 'constant' ) {
				node = this.getNodeByName( 'value' );
			} else if ( elementName === 'position' ) {
				const space = this.getAttribute( 'space' );
				node = space === 'world' ? positionWorld : positionLocal;
			} else if ( elementName === 'normal' ) {
				const space = this.getAttribute( 'space' );
				node = space === 'world' ? normalWorld : normalLocal;
			} else if ( elementName === 'tangent' ) {
				const space = this.getAttribute( 'space' );
				node = space === 'world' ? tangentWorld : tangentLocal;
			} else if ( elementName === 'texcoord' ) {
				const indexNode = this.getChildByName( 'index' );
				const index = indexNode ? parseInt( indexNode.value ) : 0;
				node = uv( index );
			} else if ( elementName === 'geomcolor' ) {
				const indexNode = this.getChildByName( 'index' );
				const index = indexNode ? parseInt( indexNode.value ) : 0;
				node = vertexColor( index );
			} else if ( elementName === 'tiledimage' ) {
				const file = this.getChildByName( 'file' );
				const textureFile = file.getTexture();
				const uvNode = this.getNodeByName( 'texcoord' ) || uv( 0 );
				const uvTiling = this.getNodeByName( 'uvtiling' );
				const uvOffset = this.getNodeByName( 'uvoffset' );
				const transformedUv = mx_transform_uv( uvNode, uvTiling, uvOffset );
				node = texture( textureFile, transformedUv );

				const colorSpaceNode = file.getColorSpaceNode();
				if ( colorSpaceNode ) node = colorSpaceNode( node );
			} else if ( elementName === 'image' ) {
				const file = this.getChildByName( 'file' );
				const uvNode = this.getNodeByName( 'texcoord' );
				const textureFile = file.getTexture();
				node = texture( textureFile, uvNode );

				const colorSpaceNode = file.getColorSpaceNode();
				if ( colorSpaceNode ) node = colorSpaceNode( node );
			} else if ( MtlXLibrary[ elementName ] !== undefined ) {
				const nodeElement = MtlXLibrary[ elementName ];
				const args = this.getNodesByNames( ...nodeElement.params );

				for ( let i = 0; i < nodeElement.params.length; i ++ ) {
					if ( args[ i ] === undefined || args[ i ] === null ) {
						const paramName = nodeElement.params[ i ];
						const defaultValue = nodeElement.defaults ? nodeElement.defaults[ paramName ] : undefined;

						if ( defaultValue !== undefined ) {
							args[ i ] = typeof defaultValue === 'function' ? defaultValue() : float( defaultValue );
						} else {
							this.materialX.issueCollector.addInvalidValue(
								this.name,
								`Missing input "${ paramName }" for node "${ this.name || this.element }" (${ this.element }). Using fallback 0.`
							);
							args[ i ] = float( 0 );
						}
					}
				}

				node = nodeElement.nodeFunc( ...args );
			}
		}

		if ( node === null || node === undefined ) {
			this.materialX.issueCollector.addUnsupportedNode( this.element, this.name );
			node = float( 0 );
		}

		const nodeToTypeClass = this.getClassFromType( type );
		if ( nodeToTypeClass !== null ) {
			node = nodeToTypeClass( node );
		} else if ( type !== null && type !== undefined ) {
			this.materialX.issueCollector.addInvalidValue( this.name, `Unexpected type "${ type }" on node "${ this.name }".` );
			node = float( 0 );
		}

		node.name = this.name;
		this.node = node;
		return node;
	}

	getChildByName( name ) {
		for ( const input of this.children ) {
			if ( input.name === name ) return input;
		}
	}

	getNodes() {
		const nodes = {};
		for ( const input of this.children ) {
			const value = input.getNode( input.output );
			nodes[ input.name ] = value;
		}
		return nodes;
	}

	getNodeByName( name ) {
		const child = this.getChildByName( name );
		return child ? child.getNode( child.output ) : undefined;
	}

	getNodesByNames( ...names ) {
		const nodes = [];
		for ( const name of names ) {
			const nodeValue = this.getNodeByName( name );
			nodes.push( nodeValue );
		}
		return nodes;
	}

	getValue() { return this.value ? this.value.trim() : ''; }

	getVector() {
		const vector = [];
		for ( const val of this.getValue().split( /[,|\s]/ ) ) {
			if ( val !== '' ) vector.push( Number( val.trim() ) );
		}
		return vector;
	}

	getAttribute( name ) { return this.nodeXML.getAttribute( name ); }

	getRecursiveAttribute( name ) {
		let attribute = this.nodeXML.getAttribute( name );
		if ( attribute === null && this.parent !== null ) {
			attribute = this.parent.getRecursiveAttribute( name );
		}
		return attribute;
	}

	setMaterial( material ) {
		const mapper = MaterialXSurfaceMappings[ this.element ];
		if ( mapper ) {
			mapper( material, this.getNodes(), this.materialX.issueCollector, this.name );
		} else {
			this.materialX.issueCollector.addUnsupportedNode( this.element, this.name );
		}
	}

	toBasicMaterial() {
		const material = new MeshBasicNodeMaterial();
		material.name = this.name;

		for ( const nodeX of this.children.toReversed() ) {
			if ( nodeX.name === 'out' ) {
				material.colorNode = nodeX.getNode();
				break;
			}
		}

		return material;
	}

	resolveSurfaceShaderNode( nodeX ) {
		if ( nodeX.hasReference ) {
			return this.materialX.getMaterialXNode( nodeX.referencePath );
		}

		if ( nodeX.nodeName ) {
			return this.materialX.getMaterialXNode( nodeX.nodeName );
		}

		return null;
	}

	toPhysicalMaterial() {
		const material = new MeshPhysicalNodeMaterial();
		material.name = this.name;

		for ( const nodeX of this.children ) {
			const shaderProperties = this.resolveSurfaceShaderNode( nodeX );
			if ( shaderProperties === null ) {
				this.materialX.issueCollector.addMissingReference( nodeX.name, nodeX.referencePath || nodeX.nodeName || '(unknown)' );
				continue;
			}
			shaderProperties.setMaterial( material );
		}

		return material;
	}

	toMaterials( materialName = null ) {
		const materials = {};
		const surfaceMaterials = this.children.filter( ( nodeX ) => nodeX.element === 'surfacematerial' );

		let selectedSurfaceMaterials = surfaceMaterials;
		if ( materialName ) {
			selectedSurfaceMaterials = surfaceMaterials.filter( ( nodeX ) => nodeX.name === materialName );

			if ( selectedSurfaceMaterials.length === 0 ) {
				this.materialX.issueCollector.addMissingMaterial( materialName );
			}
		}

		for ( const nodeX of selectedSurfaceMaterials ) {
			const material = nodeX.toPhysicalMaterial();
			materials[ material.name ] = material;
		}

		if ( Object.keys( materials ).length === 0 ) {
			for ( const nodeX of this.children ) {
				if ( nodeX.element === 'nodegraph' ) {
					const material = nodeX.toBasicMaterial();
					materials[ material.name ] = material;
				}
			}
		}

		return materials;
	}

	add( materialXNode ) {
		materialXNode.parent = this;
		this.children.push( materialXNode );
	}
}

class MaterialXDocument {
	constructor( manager, path, issueCollector, archiveResolver = null ) {
		this.manager = manager;
		this.path = path;
		this.issueCollector = issueCollector;
		this.archiveResolver = archiveResolver;

		this.nodesXLib = new Map();
		this.textureLoader = new ImageBitmapLoader( manager );
		this.textureLoader.setOptions( { imageOrientation: 'flipY' } );
		this.textureLoader.setPath( path );
		this.textureCache = new Map();
	}

	resolveTextureURI( uri ) {
		if ( this.archiveResolver ) {
			const archiveURI = this.archiveResolver( uri );
			if ( archiveURI ) return archiveURI;
		}

		return uri;
	}

	addMaterialXNode( materialXNode ) {
		this.nodesXLib.set( materialXNode.nodePath, materialXNode );
	}

	getMaterialXNode( ...names ) {
		return this.nodesXLib.get( names.join( '/' ) );
	}

	parseNode( nodeXML, nodePath = '' ) {
		const materialXNode = new MaterialXNode( this, nodeXML, nodePath );
		if ( materialXNode.nodePath ) this.addMaterialXNode( materialXNode );

		for ( const childNodeXML of nodeXML.children ) {
			const childMXNode = this.parseNode( childNodeXML, materialXNode.nodePath );
			materialXNode.add( childMXNode );
		}

		return materialXNode;
	}

	parse( text, materialName = null ) {
		const rootXML = new DOMParser().parseFromString( text, 'application/xml' ).documentElement;
		const rootNode = this.parseNode( rootXML );
		const materials = rootNode.toMaterials( materialName );
		const report = this.issueCollector.buildReport();
		return { materials, report };
	}
}

export { MaterialXDocument };
