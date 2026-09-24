import { useRef, useState } from 'react';
import { PopupOverlay } from './ui/popup-overlay';
import { Button } from './ui/button';

type PostcardGalleryCard = {
  sceneName: string;
  imageUrl: string;
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
        {cards.map((card, index) => (
          <Button
            key={card.imageUrl}
            variant="unstyled"
            size="unstyled"
            className="postcard-gallery-card"
            data-gallery-card={index}
            data-active={activeCard === index ? '' : undefined}
            type="button"
            aria-label={`View ${card.sceneName} example postcard`}
            onClick={(event) => {
              triggerRef.current = event.currentTarget;
              setActiveCard(index);
            }}
          >
            <div className="postcard-gallery-photo">
              <img
                src={card.imageUrl}
                alt={`Example ${card.sceneName} caricature postcard`}
                loading={index === 0 ? 'eager' : 'lazy'}
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
            src={selectedCard.imageUrl}
            alt={`Example ${selectedCard.sceneName} caricature postcard`}
            className="max-h-[calc(100dvh-5rem)] w-full object-contain"
          />
          <p className="mb-0 mt-4 font-display text-xl">{selectedCard.sceneName}</p>
        </PopupOverlay>
      )}
    </>
  );
}
