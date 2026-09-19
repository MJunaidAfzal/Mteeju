interface BrandMarkProps {
  tone?: 'light' | 'dark'
}

export default function BrandMark({ tone = 'dark' }: BrandMarkProps) {
  return (
    <span className={`brand brand--${tone}`}>
      <span className="brand__mark" aria-hidden="true">
        T
      </span>
      <span className="brand__name">Teeju</span>
    </span>
  )
}
