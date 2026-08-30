import { useEffect, useState, type ImgHTMLAttributes, type ReactNode } from 'react';

type SafeImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  fallback?: ReactNode;
};

/** Renders a fallback instead of exposing a broken-image glyph when media expires. */
export function SafeImage({ src, fallback = null, onError, ...props }: SafeImageProps) {
  const [failed, setFailed] = useState(!src);

  useEffect(() => setFailed(!src), [src]);

  if (failed || !src) return <>{fallback}</>;
  return <img {...props} src={src} onError={event => { setFailed(true); onError?.(event); }} />;
}

type AvatarProps = {
  src?: string | null;
  name?: string | null;
  className?: string;
  alt?: string;
};

export function Avatar({ src, name = 'Reader', className = '', alt = '' }: AvatarProps) {
  const initial = (name || 'R').trim().slice(0, 1).toUpperCase();
  return <SafeImage
    src={src || undefined}
    alt={alt}
    className={className}
    fallback={<span className={`${className} avatar-fallback`} aria-hidden={alt ? undefined : true}>{initial}</span>}
  />;
}
