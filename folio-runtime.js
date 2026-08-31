(() => {
  'use strict';

  const data = window.Year9GraphicsData;
  const cards = data?.folio_cards;
  const root = document.querySelector('[data-folio-root]');
  if (!root || !Array.isArray(cards)) return;

  const schemaVersion = '1.0';
  const courseId = 'year-9-graphics-technology';
  const textKey = 'tas:year9-graphics:v1:folio:text';
  const imageKey = 'tas:year9-graphics:v1:folio:images';
  const acceptedImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
  const maxImageBytes = 4 * 1024 * 1024;
  const maxBackupBytes = 30 * 1024 * 1024;

  const safeParse = (value, fallback) => {
    try {
      const parsed = JSON.parse(value || 'null');
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch {
      return fallback;
    }
  };

  const blankTextState = () => ({
    schema_version: schemaVersion,
    course_id: courseId,
    student_name: '',
    class_group: '',
    cards: Object.fromEntries(cards.map(card => [card.id, { response: '', caption: '', saved_at: null }]))
  });

  const normaliseTextState = raw => {
    const next = blankTextState();
    if (!raw || raw.schema_version !== schemaVersion || raw.course_id !== courseId) return next;
    next.student_name = String(raw.student_name || '');
    next.class_group = String(raw.class_group || '');
    cards.forEach(card => {
      const record = raw.cards?.[card.id];
      if (!record || typeof record !== 'object') return;
      next.cards[card.id] = {
        response: String(record.response || ''),
        caption: String(record.caption || ''),
        saved_at: record.saved_at || null
      };
    });
    return next;
  };

  const normaliseImages = raw => {
    const next = {};
    if (!raw || typeof raw !== 'object') return next;
    cards.forEach(card => {
      const value = raw[card.id];
      if (typeof value !== 'string') return;
      if (/^data:image\/(png|jpeg|webp);base64,/i.test(value)) next[card.id] = value;
    });
    return next;
  };

  let textState = normaliseTextState(safeParse(localStorage.getItem(textKey), null));
  let images = normaliseImages(safeParse(localStorage.getItem(imageKey), null));

  const statusNode = document.querySelector('[data-folio-save-status]');
  const progressNode = document.querySelector('[data-folio-progress]');
  const nextNode = document.querySelector('[data-folio-next]');
  const nameInput = document.querySelector('[data-folio-name]');
  const classInput = document.querySelector('[data-folio-class]');

  const announce = message => {
    if (statusNode) statusNode.textContent = `${message} Browser-local only; not submitted.`;
  };

  const saveText = message => {
    localStorage.setItem(textKey, JSON.stringify(textState));
    updateDashboard();
    document.dispatchEvent(new CustomEvent('year9graphics:progresschange'));
    if (message) announce(message);
  };

  const saveImages = message => {
    try {
      localStorage.setItem(imageKey, JSON.stringify(images));
      if (message) announce(message);
    } catch {
      announce('The image could not be saved. Export a backup and try a smaller image.');
    }
  };

  const cardComplete = cardId => {
    const record = textState.cards[cardId];
    return Boolean(record?.response.trim() && record?.caption.trim());
  };

  const updateCard = cardId => {
    const node = document.querySelector(`[data-folio-card="${cardId}"]`);
    const status = node?.querySelector('[data-card-status]');
    if (!status) return;
    status.textContent = cardComplete(cardId) ? 'Folio card ready' : 'Add a response and caption';
    status.dataset.complete = String(cardComplete(cardId));
  };

  const updateDashboard = () => {
    const complete = cards.filter(card => cardComplete(card.id)).length;
    if (progressNode) progressNode.textContent = `${complete} of ${cards.length} folio cards ready`;
    cards.forEach(card => updateCard(card.id));
    const next = cards.find(card => !cardComplete(card.id));
    if (nextNode) {
      nextNode.textContent = next ? `Continue: ${next.title}` : 'All folio cards have a response and caption';
      nextNode.href = next ? `#${next.id}` : '#folio-title';
    }
  };

  const updatePrintValues = cardId => {
    const record = textState.cards[cardId];
    const response = document.querySelector(`[data-folio-print-response="${cardId}"]`);
    const caption = document.querySelector(`[data-folio-print-caption="${cardId}"]`);
    if (response) response.textContent = record?.response.trim() || 'No response saved.';
    if (caption) caption.textContent = record?.caption.trim() || 'No caption saved.';
  };

  const paintImage = cardId => {
    const preview = document.querySelector(`[data-image-preview="${cardId}"]`);
    if (!preview) return;
    preview.replaceChildren();
    if (!images[cardId]) return;
    const image = document.createElement('img');
    image.src = images[cardId];
    image.alt = textState.cards[cardId]?.caption || 'Imported folio evidence preview';
    preview.append(image);
  };

  const download = (name, payload) => {
    const blob = new Blob([payload], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };

  const backupPayload = () => ({
    backup_type: 'editable-folio-backup',
    schema_version: schemaVersion,
    course_id: courseId,
    exported_at: new Date().toISOString(),
    text: textState,
    images
  });

  const createBackup = () => {
    download(`year-9-graphics-folio-backup-${new Date().toISOString().slice(0, 10)}.json`, `${JSON.stringify(backupPayload(), null, 2)}\n`);
    announce('Editable folio backup downloaded.');
  };

  const createEvidenceExport = () => {
    const payload = {
      export_type: 'formative-learning-evidence',
      schema_version: schemaVersion,
      course_id: courseId,
      formal_submission: false,
      exported_at: new Date().toISOString(),
      student_name: textState.student_name,
      class_group: textState.class_group,
      cards: cards.map(card => ({
        id: card.id,
        title: card.title,
        response: textState.cards[card.id].response,
        caption: textState.cards[card.id].caption,
        image_in_editable_backup: Boolean(images[card.id])
      }))
    };
    download(`year-9-graphics-formative-folio-${new Date().toISOString().slice(0, 10)}.json`, `${JSON.stringify(payload, null, 2)}\n`);
    announce('Formative folio evidence export downloaded.');
  };

  const restoreBackup = async file => {
    if (!file || file.size > maxBackupBytes) throw new Error('Choose a compatible Year 9 Graphics folio backup smaller than 30 MB.');
    const backup = safeParse(await file.text(), null);
    if (!backup || backup.backup_type !== 'editable-folio-backup' || backup.course_id !== courseId || backup.schema_version !== schemaVersion) {
      throw new Error('This is not a compatible Year 9 Graphics folio backup.');
    }
    textState = normaliseTextState(backup.text);
    images = normaliseImages(backup.images);
    localStorage.setItem(textKey, JSON.stringify(textState));
    localStorage.setItem(imageKey, JSON.stringify(images));
    paintAll();
    document.dispatchEvent(new CustomEvent('year9graphics:progresschange'));
    announce('Editable folio backup restored.');
  };

  const paintAll = () => {
    if (nameInput) nameInput.value = textState.student_name;
    if (classInput) classInput.value = textState.class_group;
    cards.forEach(card => {
      const response = document.querySelector(`[data-folio-response="${card.id}"]`);
      const caption = document.querySelector(`[data-folio-caption="${card.id}"]`);
      if (response) response.value = textState.cards[card.id].response;
      if (caption) caption.value = textState.cards[card.id].caption;
      updatePrintValues(card.id);
      paintImage(card.id);
    });
    updateDashboard();
  };

  nameInput?.addEventListener('input', () => {
    textState.student_name = nameInput.value;
    saveText('Learner details autosaved.');
  });

  classInput?.addEventListener('input', () => {
    textState.class_group = classInput.value;
    saveText('Learner details autosaved.');
  });

  root.querySelectorAll('[data-folio-response]').forEach(input => input.addEventListener('input', event => {
    const cardId = event.currentTarget.dataset.folioResponse;
    textState.cards[cardId].response = event.currentTarget.value;
    textState.cards[cardId].saved_at = new Date().toISOString();
    updatePrintValues(cardId);
    saveText(`${cardId.toUpperCase()} response autosaved.`);
  }));

  root.querySelectorAll('[data-folio-caption]').forEach(input => input.addEventListener('input', event => {
    const cardId = event.currentTarget.dataset.folioCaption;
    textState.cards[cardId].caption = event.currentTarget.value;
    textState.cards[cardId].saved_at = new Date().toISOString();
    updatePrintValues(cardId);
    saveText(`${cardId.toUpperCase()} caption autosaved.`);
    paintImage(cardId);
  }));

  root.querySelectorAll('[data-folio-image]').forEach(input => input.addEventListener('change', event => {
    const file = event.currentTarget.files?.[0];
    const cardId = event.currentTarget.dataset.folioImage;
    if (!file) return;
    if (!acceptedImageTypes.has(file.type)) {
      event.currentTarget.value = '';
      announce('Choose a PNG, JPEG or WebP image.');
      return;
    }
    if (file.size > maxImageBytes) {
      event.currentTarget.value = '';
      announce('Choose an image no larger than 4 MB.');
      return;
    }
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      images[cardId] = String(reader.result || '');
      saveImages(`${cardId.toUpperCase()} image saved.`);
      paintImage(cardId);
    });
    reader.readAsDataURL(file);
  }));

  document.querySelector('[data-folio-backup]')?.addEventListener('click', createBackup);
  document.querySelector('[data-folio-export]')?.addEventListener('click', createEvidenceExport);
  document.querySelector('[data-folio-print]')?.addEventListener('click', () => window.print());
  window.addEventListener('beforeprint', () => cards.forEach(card => updatePrintValues(card.id)));
  const restoreInput = document.querySelector('[data-folio-restore-input]');
  document.querySelector('[data-folio-restore]')?.addEventListener('click', () => restoreInput?.click());
  restoreInput?.addEventListener('change', async event => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    try {
      await restoreBackup(file);
    } catch (error) {
      announce(error.message || 'The backup could not be restored.');
    } finally {
      input.value = '';
    }
  });

  document.querySelector('[data-folio-reset]')?.addEventListener('click', () => {
    if (!window.confirm('Reset this Year 9 Graphics folio on this device? Download a backup first if you may need the work again.')) return;
    localStorage.removeItem(textKey);
    localStorage.removeItem(imageKey);
    textState = blankTextState();
    images = {};
    paintAll();
    document.dispatchEvent(new CustomEvent('year9graphics:progresschange'));
    announce('This device’s folio record has been reset.');
  });

  paintAll();
  announce(localStorage.getItem(textKey) ? 'Saved folio restored.' : 'Folio ready.');
})();
