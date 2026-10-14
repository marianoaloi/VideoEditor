/** Natural (EXIF-oriented) pixel size of an image URL, measured by the browser. */
export interface ImageDims {
  width: number
  height: number
}

export function measureImage(url: string): Promise<ImageDims> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('The image could not be loaded'))
    img.src = url
  })
}
