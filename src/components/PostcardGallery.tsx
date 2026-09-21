import { useRef, useState } from 'react';
import { PopupOverlay } from './ui/popup-overlay';
import { Button } from './ui/button';

type PostcardGalleryCard = {
  sceneName: string;
  index: number;
};

type PostcardGalleryProps = {
  cards: PostcardGalleryCard[];
};

export function PostcardGallery({ cards }: PostcardGalleryProps) {
  const [activeCard, setActiveCard] = useState<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedCard = activeCard === null ? null : cards[activeCard];

  return (
    <>
      <div className="postcard-gallery" data-postcard-gallery data-active={activeCard === null ? undefined : ''} role="group" aria-label="Example caricature postcards">
        {cards.map((card) => (
          <Button
            key={card.index}
            variant="unstyled"
            size="unstyled"
            className="postcard-gallery-card"
            data-gallery-card={card.index}
            data-active={activeCard === card.index ? '' : undefined}
            type="button"
            aria-label={`View ${card.sceneName} example postcard`}
            onClick={(event) => {
              triggerRef.current = event.currentTarget;
              setActiveCard(card.index);
            }}
          >
            <div className="postcard-gallery-photo">
              <img
                src="/demo-postcard.jpg"
                alt={`Example ${card.sceneName} caricature postcard`}
                loading={card.index === 0 ? 'eager' : 'lazy'}
              />
            </div>
          </Button>
        ))}
      </div>
      {selectedCard && (
        <PopupOverlay
          open
          label={`Example ${selectedCard.sceneName} postcard`}
          closeLabel="Close postcard preview"
          onClose={() => setActiveCard(null)}
          returnFocusRef={triggerRef}
        >
          <img
            src="/demo-postcard.jpg"
            alt={`Example ${selectedCard.sceneName} caricature postcard`}
            className="max-h-[calc(100dvh-5rem)] w-full object-contain"
          />
          <p className="mb-0 mt-4 font-display text-xl">{selectedCard.sceneName}</p>
        </PopupOverlay>
      )}
    </>
  );
}
