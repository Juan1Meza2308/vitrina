/**
 * Iconos de la interfaz.
 *
 * Van en SVG dentro del paquete y no como fuente de iconos ni como imagenes:
 * heredan `currentColor`, asi que siguen al tema claro y al oscuro sin una sola
 * regla mas, y no anaden una descarga que puede fallar.
 *
 * Todos comparten caja de 16 y trazo de 1.6: mezclar grosores es lo que hace
 * que un juego de iconos parezca recortado de sitios distintos.
 *
 * Un icono NUNCA va solo cuando nombra una accion poco obvia: lleva su texto al
 * lado o, como minimo, `title` y `aria-label`. Un boton que solo ensena un
 * dibujo obliga a adivinar.
 */
interface Props {
  /** Tamano en px. 16 por defecto, que es el del texto de la interfaz. */
  size?: number;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export const IconoGrabacion = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <rect x="1.4" y="4" width="9.2" height="8" rx="2" />
    <path d="M10.6 8.4 14.6 6v4l-4-2.4Z" />
  </svg>
);

export const IconoAjustes = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <circle cx="8" cy="8" r="2.1" />
    <path d="M8 1.6v1.6M8 12.8v1.6M14.4 8h-1.6M3.2 8H1.6M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1M12.5 12.5l-1.1-1.1M4.6 4.6 3.5 3.5" />
  </svg>
);

export const IconoRepetir = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M2 8a6 6 0 0 1 10.2-4.2M14 8A6 6 0 0 1 3.8 12.2" />
    <path d="M12.4 1.4v2.6h-2.6M3.6 14.6V12H6.2" />
  </svg>
);

export const IconoImagen = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <rect x="1.6" y="2.6" width="12.8" height="10.8" rx="2" />
    <circle cx="5.6" cy="6.4" r="1.2" />
    <path d="m2.4 11.6 3.4-3.2 2.6 2.4 2-1.8 3.2 3" />
  </svg>
);

export const IconoReproducir = ({ size = 16 }: Props) => (
  <svg {...base(size)} fill="currentColor" stroke="none">
    <path d="M4.6 3.2a.6.6 0 0 1 .92-.5l7 4.3a.6.6 0 0 1 0 1.02l-7 4.3a.6.6 0 0 1-.92-.51V3.2Z" />
  </svg>
);

export const IconoPausa = ({ size = 16 }: Props) => (
  <svg {...base(size)} fill="currentColor" stroke="none">
    <rect x="4" y="3" width="2.8" height="10" rx="1" />
    <rect x="9.2" y="3" width="2.8" height="10" rx="1" />
  </svg>
);

export const IconoInicio = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M4 3v10" />
    <path d="M13 3.4v9.2L5.6 8Z" fill="currentColor" stroke="none" />
  </svg>
);

export const IconoSonido = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M3 6.2h2.2L8.6 3.4v9.2L5.2 9.8H3z" />
    <path d="M10.8 6.2a2.4 2.4 0 0 1 0 3.6" />
  </svg>
);

export const IconoSilencio = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M3 6.2h2.2L8.6 3.4v9.2L5.2 9.8H3z" />
    <path d="m11 6 3 4M14 6l-3 4" />
  </svg>
);

export const IconoAnadir = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <rect x="1.6" y="4" width="12.8" height="8" rx="2" />
    <path d="M8 6.4v3.2M6.4 8h3.2" />
  </svg>
);

export const IconoBorrar = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M2.6 4.4h10.8M6 4.4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.4" />
    <path d="M12.2 4.4 11.7 13a1 1 0 0 1-1 .9H5.3a1 1 0 0 1-1-.9L3.8 4.4" />
  </svg>
);
