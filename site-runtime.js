(() => {
  'use strict';

  const data = window.Year9GraphicsData;
  if (!data) return;

  const notifyProgress = () => document.dispatchEvent(new CustomEvent('year9graphics:progresschange'));
  const blankPackage = () => ({ answers: {}, checked: {}, long_response: '', saved_at: null });
  const blankPractice = () => ({ responses: {}, checked: false, checked_at: null, saved_at: null });

  const read = (key, fallback) => {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || '{}');
      return { ...fallback(), ...(parsed && typeof parsed === 'object' ? parsed : {}) };
    } catch {
      return fallback();
    }
  };

  const save = (key, state) => {
    state.saved_at = new Date().toISOString();
    localStorage.setItem(key, JSON.stringify(state));
    notifyProgress();
  };

  const download = (name, payload, type = 'application/json') => {
    const blob = new Blob([payload], { type });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };

  const initialiseVideoPlayers = () => {
    const launches = [...document.querySelectorAll('[data-video-launch]')];
    if (!launches.length) return;

    const closePlayer = (frame, restoreFocus = true) => {
      const launch = frame.querySelector('[data-video-launch]');
      frame.querySelector('iframe')?.remove();
      frame.querySelector('[data-video-close]')?.remove();
      frame.removeAttribute('data-player-open');
      if (launch) {
        launch.hidden = false;
        if (restoreFocus) launch.focus();
      }
    };

    launches.forEach(launch => {
      launch.addEventListener('click', () => {
        const frame = launch.closest('[data-video-frame]');
        const videoId = String(launch.dataset.videoId || '');
        if (!frame || !/^[A-Za-z0-9_-]{11}$/.test(videoId) || frame.querySelector('iframe')) return;

        document.querySelectorAll('[data-video-frame][data-player-open]').forEach(otherFrame => {
          if (otherFrame !== frame) closePlayer(otherFrame, false);
        });

        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'video-close';
        close.dataset.videoClose = '';
        close.textContent = 'Close video player';
        close.addEventListener('click', () => closePlayer(frame));

        const iframe = document.createElement('iframe');
        iframe.src = `https://www.youtube-nocookie.com/embed/${videoId}?rel=0`;
        iframe.title = launch.dataset.videoTitle || 'Course tutorial';
        iframe.loading = 'eager';
        iframe.referrerPolicy = 'strict-origin-when-cross-origin';
        iframe.setAttribute('allow', 'encrypted-media; picture-in-picture; web-share');
        iframe.setAttribute('allowfullscreen', '');

        launch.hidden = true;
        frame.dataset.playerOpen = '';
        frame.append(close, iframe);
        close.focus();
      });
    });

    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const active = document.querySelector('[data-video-frame][data-player-open]');
      if (!active) return;
      event.preventDefault();
      closePlayer(active);
    });
  };

  const packageProgress = (sectionId, state) => {
    const model = data.packages[sectionId];
    const checked = model.questions.filter(question => state.checked?.[question.question_id] === true).length;
    const capstone = String(state.long_response || '').trim().length > 0;
    return {
      checked,
      total: model.questions.length,
      capstone,
      complete: checked === model.questions.length && capstone,
      label: checked === model.questions.length && capstone
        ? `Complete: ${checked}/${model.questions.length} questions checked and capstone saved`
        : `${checked}/${model.questions.length} questions checked; capstone ${capstone ? 'saved' : 'not started'}`
    };
  };

  const updateModuleProgress = () => {
    for (const module of data.modules) {
      const node = document.querySelector(`[data-module-progress="${module.id}"]`);
      if (!node) continue;
      const complete = module.section_ids.filter(sectionId => {
        const model = data.packages[sectionId];
        const key = `${data.progress.storage_namespace}:section:${sectionId}`;
        return model && packageProgress(sectionId, read(key, blankPackage)).complete;
      }).length;
      node.textContent = complete === 3 ? '3 of 3 sections complete' : complete ? `${complete} of 3 sections complete` : 'Not started';
    }
  };

  const updateReview = (sectionId, state) => {
    const progress = packageProgress(sectionId, state);
    document.querySelectorAll(`[data-review-status="${sectionId}"]`).forEach(node => { node.textContent = progress.label; });
    document.querySelectorAll(`.learning-package[data-section-id="${sectionId}"] [data-package-summary]`).forEach(node => { node.textContent = progress.label; });
    updateModuleProgress();
    return progress;
  };

  for (const node of document.querySelectorAll('.learning-package')) {
    const sectionId = node.dataset.sectionId;
    const key = node.dataset.storageKey;
    const model = data.packages[sectionId];
    if (!model || !key) continue;
    let state = read(key, blankPackage);
    const status = node.querySelector('[data-save-status]');

    const setStatus = prefix => {
      const progress = updateReview(sectionId, state);
      if (status) status.textContent = `${prefix} — ${progress.label}. Browser-local only; not submitted.`;
    };

    const paintQuestion = (question, showMissing = false) => {
      const fieldset = node.querySelector(`[data-question-id="${question.question_id}"]`);
      const feedback = fieldset?.querySelector('[data-question-feedback]');
      if (!fieldset || !feedback) return;
      const selected = fieldset.querySelector('input[type="radio"]:checked');
      if (showMissing && !selected) {
        feedback.textContent = 'Choose one response before checking.';
        feedback.dataset.correct = 'false';
        return;
      }
      if (!state.checked?.[question.question_id]) {
        feedback.textContent = '';
        feedback.removeAttribute('data-correct');
        return;
      }
      if (!selected) {
        feedback.textContent = 'Choose one response before checking.';
        feedback.dataset.correct = 'false';
        return;
      }
      const option = question.options.find(item => item.option_id === selected.value);
      feedback.textContent = option?.feedback || 'Feedback is not yet available.';
      feedback.dataset.correct = String(selected.value === question.correct_option_id);
    };

    for (const question of model.questions) {
      const fieldset = node.querySelector(`[data-question-id="${question.question_id}"]`);
      if (!fieldset) continue;
      const saved = state.answers?.[question.question_id];
      if (saved) {
        const input = fieldset.querySelector(`input[value="${CSS.escape(saved)}"]`);
        if (input) input.checked = true;
      }
      fieldset.querySelectorAll('input[type="radio"]').forEach(input => input.addEventListener('change', () => {
        state.answers[question.question_id] = input.value;
        state.checked[question.question_id] = false;
        save(key, state);
        paintQuestion(question);
        setStatus('Saved; check the revised response when ready');
      }));
      fieldset.querySelector('[data-check-question]')?.addEventListener('click', () => {
        const selected = fieldset.querySelector('input[type="radio"]:checked');
        state.checked[question.question_id] = Boolean(selected);
        if (selected) state.answers[question.question_id] = selected.value;
        save(key, state);
        paintQuestion(question, !selected);
        setStatus(selected ? 'Checked and saved' : 'Response needed');
      });
      paintQuestion(question);
    }

    const response = node.querySelector('[data-long-response]');
    if (response) {
      response.value = state.long_response || '';
      response.addEventListener('input', () => {
        state.long_response = response.value;
        save(key, state);
        setStatus('Autosaved');
      });
    }

    node.querySelector('[data-reset-package]')?.addEventListener('click', () => {
      if (!window.confirm(`Reset only the ${sectionId.toUpperCase()} formative learning package on this device?`)) return;
      localStorage.removeItem(key);
      state = blankPackage();
      node.querySelectorAll('input[type="radio"]').forEach(input => { input.checked = false; });
      node.querySelectorAll('[data-question-feedback]').forEach(item => {
        item.textContent = '';
        item.removeAttribute('data-correct');
      });
      if (response) response.value = '';
      setStatus('Reset');
      notifyProgress();
    });

    node.querySelector('[data-export-package]')?.addEventListener('click', () => {
      const payload = {
        schema_version: '1.0',
        label: 'Formative learning evidence',
        course_id: data.progress.course_id,
        section_id: sectionId,
        formal_submission: false,
        exported_at: new Date().toISOString(),
        ...state
      };
      download(`${sectionId}-formative-learning-evidence.json`, `${JSON.stringify(payload, null, 2)}\n`);
    });

    node.querySelector('[data-print-package]')?.addEventListener('click', () => {
      document.body.dataset.printPackage = sectionId;
      window.print();
      delete document.body.dataset.printPackage;
    });

    setStatus(state.saved_at ? 'Restored' : 'Not started');
  }

  const controlKey = control => control.name || control.id;
  const readControl = control => control.type === 'checkbox' ? control.checked : control.value;
  const restoreControl = (control, value) => {
    if (control.type === 'checkbox') control.checked = Boolean(value);
    else if (control.type === 'radio') control.checked = control.value === value;
    else control.value = value ?? '';
  };

  const evaluationRows = card => [...card.querySelectorAll('[data-checkable]')];
  const evaluateRow = row => {
    const actual = String(row.value || '');
    const feedbackNode = row.closest('.practice-question')?.querySelector('[data-inline-feedback]');
    const answered = actual !== '';
    const correct = answered && actual === String(row.dataset.expected);
    if (feedbackNode) {
      feedbackNode.textContent = answered
        ? (row.dataset.feedback || (correct ? 'Correct — keep the evidence link.' : 'Revisit the concept and retry.'))
        : 'Choose a response before checking.';
      feedbackNode.dataset.correct = String(correct);
    }
    return { answered, correct };
  };

  const practiceStatus = (card, state) => {
    const authentic = [...card.querySelectorAll('[data-authentic]')];
    const hasAny = Object.values(state.responses || {}).some(value => value === true || String(value ?? '').trim());
    const authenticComplete = authentic.every(control => String(readControl(control) ?? '').trim().length > 0);
    const complete = state.checked === true && authenticComplete;
    return { complete, label: complete ? 'Practice complete' : hasAny ? 'In progress' : 'Not started' };
  };

  for (const card of document.querySelectorAll('[data-practice-card]')) {
    const key = card.dataset.storageKey;
    let state = read(key, blankPractice);
    const controls = [...card.querySelectorAll('[data-practice-input]')];
    const status = card.querySelector('[data-practice-status]');

    const updateStatus = prefix => {
      const value = practiceStatus(card, state);
      if (status) {
        status.textContent = `${prefix}: ${value.label}. Browser-local formative practice; not submitted.`;
        status.dataset.complete = String(value.complete);
      }
    };

    controls.forEach(control => {
      const saved = state.responses?.[controlKey(control)];
      if (saved !== undefined) restoreControl(control, saved);
      control.addEventListener('input', () => {
        state.responses[controlKey(control)] = readControl(control);
        state.checked = false;
        save(key, state);
        updateStatus('Saved');
      });
    });

    card.querySelector('[data-check-practice]')?.addEventListener('click', () => {
      const results = evaluationRows(card).map(evaluateRow);
      const allAnswered = results.every(result => result.answered);
      state.checked = allAnswered;
      state.checked_at = allAnswered ? new Date().toISOString() : null;
      controls.forEach(control => { state.responses[controlKey(control)] = readControl(control); });
      save(key, state);
      const correct = results.filter(result => result.correct).length;
      updateStatus(allAnswered ? `Checked ${correct}/${results.length}; retry remains available` : 'Some checkable responses still need an answer');
    });

    card.querySelector('[data-reset-practice]')?.addEventListener('click', () => {
      const label = card.dataset.recordKind === 'puzzle' ? 'puzzle' : 'activity';
      if (!window.confirm(`Reset only this ${label}: ${card.dataset.recordId}?`)) return;
      localStorage.removeItem(key);
      state = blankPractice();
      controls.forEach(control => {
        if (control.type === 'checkbox' || control.type === 'radio') control.checked = false;
        else control.value = '';
      });
      card.querySelectorAll('[data-inline-feedback]').forEach(node => {
        node.textContent = '';
        node.removeAttribute('data-correct');
      });
      updateStatus('Reset');
      notifyProgress();
    });

    updateStatus(state.saved_at ? 'Restored' : 'Ready');
  }

  document.querySelectorAll('[data-review-link]').forEach(link => {
    link.addEventListener('click', () => {
      const target = document.querySelector(link.getAttribute('href'));
      if (target instanceof HTMLDetailsElement) {
        target.open = true;
        requestAnimationFrame(() => target.querySelector('summary')?.focus());
      }
    });
  });

  initialiseVideoPlayers();
  updateModuleProgress();
})();
