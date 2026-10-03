import { useState, type ReactElement } from 'react'
import { Heart, ThumbsDown } from 'lucide-react'
import type { Feedback } from '@shared/music'

interface FeedbackButtonsProps {
  feedback: Feedback
  onToggleLike: () => void
  onToggleDislike: () => void
  size?: 'sm' | 'md'
}

/**
 * Par Like/Dislike com toggle real (clicar de novo limpa → 'neutral').
 * like = âmbar/ouro · dislike = rosa — os acentos do design system.
 */
export function FeedbackButtons({ feedback, onToggleLike, onToggleDislike, size = 'sm' }: FeedbackButtonsProps): ReactElement {
  const [bump, setBump] = useState<'like' | 'dislike' | null>(null)
  const px = size === 'sm' ? 'h-7 w-7' : 'h-8 w-8'
  const icon = size === 'sm' ? 'h-[15px] w-[15px]' : 'h-4 w-4'

  const fire = (which: 'like' | 'dislike', fn: () => void): void => {
    setBump(which)
    fn()
    window.setTimeout(() => setBump(null), 260)
  }

  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        aria-pressed={feedback === 'liked'}
        title={feedback === 'liked' ? 'Remover dos Favoritas' : 'Favoritar (L)'}
        onClick={(e) => {
          e.stopPropagation()
          fire('like', onToggleLike)
        }}
        className={`inline-flex ${px} cursor-default items-center justify-center rounded-lg transition-all duration-150 ease-precise ${
          feedback === 'liked'
            ? 'text-amber-400 hover:bg-amber-400/10'
            : 'text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200'
        } ${bump === 'like' ? 'scale-[1.35]' : 'scale-100'}`}
      >
        <Heart className={`${icon} transition-transform`} fill={feedback === 'liked' ? 'currentColor' : 'none'} strokeWidth={feedback === 'liked' ? 1.5 : 1.75} />
      </button>
      <button
        type="button"
        aria-pressed={feedback === 'disliked'}
        title={feedback === 'disliked' ? 'Remover da blacklist' : 'Rejeitar — o shuffle vai pular (K)'}
        onClick={(e) => {
          e.stopPropagation()
          fire('dislike', onToggleDislike)
        }}
        className={`inline-flex ${px} cursor-default items-center justify-center rounded-lg transition-all duration-150 ease-precise ${
          feedback === 'disliked'
            ? 'text-rose-400 hover:bg-rose-400/10'
            : 'text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200'
        } ${bump === 'dislike' ? 'scale-[1.35]' : 'scale-100'}`}
      >
        <ThumbsDown className={`${icon} transition-transform`} fill={feedback === 'disliked' ? 'currentColor' : 'none'} strokeWidth={feedback === 'disliked' ? 1.5 : 1.75} />
      </button>
    </div>
  )
}
