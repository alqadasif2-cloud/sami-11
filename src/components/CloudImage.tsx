import React, { useState } from 'react';
import { ImageOff, Loader2 } from 'lucide-react';

interface CloudImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src?: string | null;
  alt?: string;
  className?: string;
}

export const CloudImage: React.FC<CloudImageProps> = ({
  src,
  alt = '',
  className = '',
  ...props
}) => {
  const [hasError, setHasError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  if (!src || hasError) {
    return (
      <div
        className={`flex items-center justify-center bg-slate-900/60 border border-slate-800 text-slate-500 rounded ${className}`}
      >
        <ImageOff className="w-5 h-5 opacity-60" />
      </div>
    );
  }

  return (
    <div className={`relative inline-block overflow-hidden ${className}`}>
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs z-10">
          <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
        </div>
      )}
      <img
        src={src}
        alt={alt}
        className={`w-full h-full object-cover transition-opacity duration-200 ${
          isLoading ? 'opacity-0' : 'opacity-100'
        }`}
        onLoad={() => setIsLoading(false)}
        onError={() => {
          setIsLoading(false);
          setHasError(true);
        }}
        {...props}
      />
    </div>
  );
};
