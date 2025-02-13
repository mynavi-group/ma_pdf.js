/* Copyright 2025 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  AnnotationEditorParamsType,
  DOMSVGFactory,
  noContextMenu,
  SignatureExtractor,
  stopEvent,
  SupportedImageMimeTypes,
} from "pdfjs-lib";

// Default height of the added signature in page coordinates.
const DEFAULT_HEIGHT_IN_PAGE = 40;

class SignatureManager {
  #addButton;

  #tabsToAltText = null;

  #clearButton;

  #clearDescription;

  #currentEditor;

  #description;

  #dialog;

  #drawCurves = null;

  #drawPlaceholder;

  #drawPath = null;

  #drawPathString = "";

  #drawPoints = null;

  #drawSVG;

  #drawThickness;

  #errorBar;

  #extractedSignatureData = null;

  #imagePath = null;

  #imagePicker;

  #imagePickerLink;

  #imagePlaceholder;

  #imageSVG;

  #saveCheckbox;

  #saveContainer;

  #tabButtons;

  #addSignatureToolbarButton;

  #loadSignaturesPromise = null;

  #typeInput;

  #currentTab = null;

  #currentTabAC = null;

  #hasDescriptionChanged = false;

  #eventBus;

  #l10n;

  #overlayManager;

  #editDescriptionDialog;

  #signatureStorage;

  #uiManager = null;

  static #l10nDescription = null;

  constructor(
    {
      dialog,
      panels,
      typeButton,
      typeInput,
      drawButton,
      drawPlaceholder,
      drawSVG,
      drawThickness,
      imageButton,
      imageSVG,
      imagePlaceholder,
      imagePicker,
      imagePickerLink,
      description,
      clearButton,
      cancelButton,
      addButton,
      errorCloseButton,
      errorBar,
      saveCheckbox,
      saveContainer,
    },
    editSignatureElements,
    addSignatureToolbarButton,
    overlayManager,
    l10n,
    signatureStorage,
    eventBus
  ) {
    this.#addButton = addButton;
    this.#clearButton = clearButton;
    this.#clearDescription = description.lastElementChild;
    this.#description = description.firstElementChild;
    this.#dialog = dialog;
    this.#drawSVG = drawSVG;
    this.#drawPlaceholder = drawPlaceholder;
    this.#drawThickness = drawThickness;
    this.#errorBar = errorBar;
    this.#imageSVG = imageSVG;
    this.#imagePlaceholder = imagePlaceholder;
    this.#imagePicker = imagePicker;
    this.#imagePickerLink = imagePickerLink;
    this.#overlayManager = overlayManager;
    this.#saveCheckbox = saveCheckbox;
    this.#saveContainer = saveContainer;
    this.#addSignatureToolbarButton = addSignatureToolbarButton;
    this.#typeInput = typeInput;
    this.#l10n = l10n;
    this.#signatureStorage = signatureStorage;
    this.#eventBus = eventBus;
    this.#editDescriptionDialog = new EditDescriptionDialog(
      editSignatureElements,
      overlayManager
    );

    SignatureManager.#l10nDescription ||= Object.freeze({
      signature: "pdfjs-editor-add-signature-description-default-when-drawing",
    });

    dialog.addEventListener("close", this.#close.bind(this));
    dialog.addEventListener("contextmenu", e => {
      const { target } = e;
      if (target !== this.#typeInput && target !== this.#description) {
        e.preventDefault();
      }
    });
    dialog.addEventListener("drop", e => {
      stopEvent(e);
    });
    cancelButton.addEventListener("click", this.#cancel.bind(this));
    addButton.addEventListener("click", this.#add.bind(this));
    clearButton.addEventListener(
      "click",
      () => {
        this.#initTab(null);
      },
      { passive: true }
    );
    description.addEventListener(
      "input",
      () => {
        this.#clearDescription.disabled = description.value === "";
      },
      { passive: true }
    );
    this.#clearDescription.addEventListener(
      "click",
      () => {
        this.#description.value = "";
        this.#clearDescription.disabled = true;
      },
      { passive: true }
    );
    errorCloseButton.addEventListener(
      "click",
      () => {
        errorBar.hidden = true;
      },
      { passive: true }
    );

    this.#initTabButtons(typeButton, drawButton, imageButton, panels);
    imagePicker.accept = SupportedImageMimeTypes.join(",");

    eventBus._on("storedsignatureschanged", this.#signaturesChanged.bind(this));

    overlayManager.register(dialog);
  }

  #initTabButtons(typeButton, drawButton, imageButton, panels) {
    const buttons = (this.#tabButtons = new Map([
      ["type", typeButton],
      ["draw", drawButton],
      ["image", imageButton],
    ]));
    const tabCallback = e => {
      for (const [name, button] of buttons) {
        if (button === e.target) {
          button.setAttribute("aria-selected", true);
          button.setAttribute("tabindex", 0);
          panels.setAttribute("data-selected", name);
          this.#initTab(name);
        } else {
          button.setAttribute("aria-selected", false);
          // Only the active tab is focusable: the others can be
          // reached by keyboard navigation (left/right arrows).
          button.setAttribute("tabindex", -1);
        }
      }
    };

    const buttonsArray = Array.from(buttons.values());
    for (let i = 0, ii = buttonsArray.length; i < ii; i++) {
      const button = buttonsArray[i];
      button.addEventListener("click", tabCallback, { passive: true });
      button.addEventListener(
        "keydown",
        ({ key }) => {
          if (key !== "ArrowLeft" && key !== "ArrowRight") {
            return;
          }
          buttonsArray[i + (key === "ArrowLeft" ? -1 : 1)]?.focus();
        },
        { passive: true }
      );
    }
  }

  #resetCommon() {
    this.#hasDescriptionChanged = false;
    this.#description.value = "";
    this.#tabsToAltText.set(this.#currentTab, "");
  }

  #resetTab(name) {
    switch (name) {
      case "type":
        this.#typeInput.value = "";
        break;
      case "draw":
        this.#drawCurves = null;
        this.#drawPoints = null;
        this.#drawPathString = "";
        this.#drawPath?.remove();
        this.#drawPath = null;
        this.#drawPlaceholder.hidden = false;
        this.#drawThickness.value = 1;
        break;
      case "image":
        this.#imagePlaceholder.hidden = false;
        this.#imagePath?.remove();
        this.#imagePath = null;
        break;
    }
  }

  #initTab(name) {
    if (name && this.#currentTab === name) {
      return;
    }
    if (this.#currentTab) {
      this.#tabsToAltText.set(this.#currentTab, this.#description.value);
    }
    if (name) {
      this.#currentTab = name;
    }

    const reset = !name;
    if (reset) {
      this.#resetCommon();
    } else {
      this.#description.value = this.#tabsToAltText.get(this.#currentTab);
    }
    this.#clearDescription.disabled = this.#description.value === "";
    this.#currentTabAC?.abort();
    this.#currentTabAC = new AbortController();
    switch (this.#currentTab) {
      case "type":
        this.#initTypeTab(reset);
        break;
      case "draw":
        this.#initDrawTab(reset);
        break;
      case "image":
        this.#initImageTab(reset);
        break;
    }
  }

  #disableButtons(value) {
    this.#clearButton.disabled = this.#addButton.disabled = !value;
    if (value) {
      this.#saveContainer.removeAttribute("disabled");
    } else {
      this.#saveContainer.setAttribute("disabled", true);
    }
  }

  #initTypeTab(reset) {
    if (reset) {
      this.#resetTab("type");
    }

    this.#disableButtons(this.#typeInput.value);

    const { signal } = this.#currentTabAC;
    const options = { passive: true, signal };
    this.#typeInput.addEventListener(
      "input",
      () => {
        const { value } = this.#typeInput;
        if (!this.#hasDescriptionChanged) {
          this.#description.value = value;
          this.#clearDescription.disabled = value === "";
        }
        this.#disableButtons(value);
      },
      options
    );
    this.#description.addEventListener(
      "input",
      () => {
        this.#hasDescriptionChanged =
          this.#typeInput.value !== this.#description.value;
      },
      options
    );
  }

  #initDrawTab(reset) {
    if (reset) {
      this.#resetTab("draw");
    }

    this.#disableButtons(this.#drawPath);

    const { signal } = this.#currentTabAC;
    const options = { signal };
    let currentPointerId = NaN;
    const drawCallback = e => {
      const { pointerId } = e;
      if (!isNaN(currentPointerId) && currentPointerId !== pointerId) {
        return;
      }
      currentPointerId = pointerId;
      e.preventDefault();
      this.#drawSVG.setPointerCapture(pointerId);

      const { width: drawWidth, height: drawHeight } =
        this.#drawSVG.getBoundingClientRect();
      let { offsetX, offsetY } = e;
      offsetX = Math.round(offsetX);
      offsetY = Math.round(offsetY);
      if (e.target === this.#drawPlaceholder) {
        this.#drawPlaceholder.hidden = true;
      }
      if (!this.#drawCurves) {
        this.#drawCurves = {
          width: drawWidth,
          height: drawHeight,
          thickness: parseInt(this.#drawThickness.value),
          curves: [],
        };
        this.#disableButtons(true);

        const svgFactory = new DOMSVGFactory();
        const path = (this.#drawPath = svgFactory.createElement("path"));
        path.setAttribute("stroke-width", this.#drawThickness.value);
        this.#drawSVG.append(path);
        this.#drawSVG.addEventListener("pointerdown", drawCallback, options);
        this.#drawPlaceholder.removeEventListener("pointerdown", drawCallback);
        if (this.#description.value === "") {
          this.#l10n
            .get(SignatureManager.#l10nDescription.signature)
            .then(description => {
              this.#description.value ||= description;
              this.#clearDescription.disabled = this.#description.value === "";
            });
        }
      }

      this.#drawPoints = [offsetX, offsetY];
      this.#drawCurves.curves.push({ points: this.#drawPoints });
      this.#drawPathString += `M ${offsetX} ${offsetY}`;
      this.#drawPath.setAttribute("d", this.#drawPathString);

      const finishDrawAC = new AbortController();
      const listenerDrawOptions = {
        signal: AbortSignal.any([signal, finishDrawAC.signal]),
      };
      this.#drawSVG.addEventListener(
        "contextmenu",
        noContextMenu,
        listenerDrawOptions
      );
      this.#drawSVG.addEventListener(
        "pointermove",
        evt => {
          evt.preventDefault();
          let { offsetX: x, offsetY: y } = evt;
          x = Math.round(x);
          y = Math.round(y);
          const drawPoints = this.#drawPoints;
          if (
            x < 0 ||
            y < 0 ||
            x > drawWidth ||
            y > drawHeight ||
            (x === drawPoints.at(-2) && y === drawPoints.at(-1))
          ) {
            return;
          }
          if (drawPoints.length >= 4) {
            const [x1, y1, x2, y2] = drawPoints.slice(-4);
            this.#drawPathString += `C${(x1 + 5 * x2) / 6} ${(y1 + 5 * y2) / 6} ${(5 * x2 + x) / 6} ${(5 * y2 + y) / 6} ${(x2 + x) / 2} ${(y2 + y) / 2}`;
          } else {
            this.#drawPathString += `L${x} ${y}`;
          }
          drawPoints.push(x, y);
          this.#drawPath.setAttribute("d", this.#drawPathString);
        },
        listenerDrawOptions
      );
      this.#drawSVG.addEventListener(
        "pointerup",
        evt => {
          const { pointerId: pId } = evt;
          if (!isNaN(currentPointerId) && currentPointerId !== pId) {
            return;
          }
          currentPointerId = NaN;
          evt.preventDefault();
          this.#drawSVG.releasePointerCapture(pId);
          finishDrawAC.abort();
          if (this.#drawPoints.length === 2) {
            this.#drawPathString += `L${this.#drawPoints[0]} ${this.#drawPoints[1]}`;
            this.#drawPath.setAttribute("d", this.#drawPathString);
          }
        },
        listenerDrawOptions
      );
    };
    if (this.#drawCurves) {
      this.#drawSVG.addEventListener("pointerdown", drawCallback, options);
    } else {
      this.#drawPlaceholder.addEventListener(
        "pointerdown",
        drawCallback,
        options
      );
    }
    this.#drawThickness.addEventListener(
      "input",
      () => {
        const { value: thickness } = this.#drawThickness;
        this.#drawThickness.setAttribute(
          "data-l10n-args",
          JSON.stringify({ thickness })
        );
        if (!this.#drawCurves) {
          return;
        }
        this.#drawPath.setAttribute("stroke-width", thickness);
        this.#drawCurves.thickness = thickness;
      },
      options
    );
  }

  #initImageTab(reset) {
    if (reset) {
      this.#resetTab("image");
    }

    this.#disableButtons(this.#imagePath);

    const { signal } = this.#currentTabAC;
    const options = { signal };
    const passiveOptions = { passive: true, signal };
    this.#imagePickerLink.addEventListener(
      "keydown",
      e => {
        const { key } = e;
        if (key === "Enter" || key === " ") {
          stopEvent(e);
          this.#imagePicker.click();
        }
      },
      options
    );
    this.#imagePicker.addEventListener(
      "click",
      () => {
        this.#dialog.classList.toggle("waiting", true);
      },
      passiveOptions
    );
    this.#imagePicker.addEventListener(
      "change",
      async () => {
        const file = this.#imagePicker.files?.[0];
        if (!file || !SupportedImageMimeTypes.includes(file.type)) {
          this.#errorBar.hidden = false;
          this.#dialog.classList.toggle("waiting", false);
          return;
        }
        await this.#extractSignature(file);
      },
      passiveOptions
    );
    this.#imagePicker.addEventListener(
      "cancel",
      () => {
        this.#dialog.classList.toggle("waiting", false);
      },
      passiveOptions
    );
    this.#imagePlaceholder.addEventListener(
      "dragover",
      e => {
        const { dataTransfer } = e;
        for (const { type } of dataTransfer.items) {
          if (!SupportedImageMimeTypes.includes(type)) {
            continue;
          }
          dataTransfer.dropEffect =
            dataTransfer.effectAllowed === "copy" ? "copy" : "move";
          stopEvent(e);
          return;
        }
        dataTransfer.dropEffect = "none";
      },
      options
    );
    this.#imagePlaceholder.addEventListener(
      "drop",
      e => {
        const {
          dataTransfer: { files },
        } = e;
        if (!files?.length) {
          return;
        }
        for (const file of files) {
          if (SupportedImageMimeTypes.includes(file.type)) {
            this.#extractSignature(file);
            break;
          }
        }
        stopEvent(e);
        this.#dialog.classList.toggle("waiting", true);
      },
      options
    );
  }

  async #extractSignature(file) {
    let data;
    try {
      data = await this.#uiManager.imageManager.getFromFile(file);
    } catch (e) {
      console.error("SignatureManager.#extractSignature.", e);
    }
    if (!data) {
      this.#errorBar.hidden = false;
      this.#dialog.classList.toggle("waiting", false);
      return;
    }

    const { outline } = (this.#extractedSignatureData =
      this.#currentEditor.getFromImage(data.bitmap));

    if (!outline) {
      this.#dialog.classList.toggle("waiting", false);
      return;
    }

    this.#imagePlaceholder.hidden = true;
    this.#disableButtons(true);

    const svgFactory = new DOMSVGFactory();
    const path = (this.#imagePath = svgFactory.createElement("path"));
    this.#imageSVG.setAttribute("viewBox", outline.viewBox);
    this.#imageSVG.setAttribute("preserveAspectRatio", "xMidYMid meet");
    this.#imageSVG.append(path);
    path.setAttribute("d", outline.toSVGPath());
    if (this.#description.value === "") {
      this.#description.value = file.name || "";
      this.#clearDescription.disabled = this.#description.value === "";
    }

    this.#dialog.classList.toggle("waiting", false);
  }

  #getOutlineForType() {
    return this.#currentEditor.getFromText(
      this.#typeInput.value,
      window.getComputedStyle(this.#typeInput)
    );
  }

  #getOutlineForDraw() {
    const { width, height } = this.#drawSVG.getBoundingClientRect();
    return this.#currentEditor.getDrawnSignature(
      this.#drawCurves,
      width,
      height
    );
  }

  #addToolbarButton(signatureData, uuid, description) {
    const { curves, areContours, thickness, width, height } = signatureData;
    const maxDim = Math.max(width, height);
    const outlineData = SignatureExtractor.processDrawnLines({
      lines: {
        curves,
        thickness,
        width,
        height,
      },
      pageWidth: maxDim,
      pageHeight: maxDim,
      rotation: 0,
      innerMargin: 0,
      mustSmooth: false,
      areContours,
    });
    if (!outlineData) {
      return;
    }

    const { outline } = outlineData;
    const svgFactory = new DOMSVGFactory();

    const div = document.createElement("div");
    const button = document.createElement("button");

    button.addEventListener("click", () => {
      this.#eventBus.dispatch("switchannotationeditorparams", {
        source: this,
        type: AnnotationEditorParamsType.CREATE,
        value: {
          signatureData: {
            lines: {
              curves,
              thickness,
              width,
              height,
            },
            mustSmooth: false,
            areContours,
            description,
            uuid,
            heightInPage: DEFAULT_HEIGHT_IN_PAGE,
          },
        },
      });
    });
    div.append(button);
    div.classList.add("toolbarAddSignatureButtonContainer");

    const svg = svgFactory.create(1, 1, true);
    button.append(svg);

    const span = document.createElement("span");
    button.append(span);

    button.classList.add("toolbarAddSignatureButton");
    button.type = "button";
    button.title = span.textContent = description;
    button.tabIndex = 0;

    const path = svgFactory.createElement("path");
    svg.append(path);
    svg.setAttribute("viewBox", outline.viewBox);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    if (areContours) {
      path.classList.add("contours");
    }
    path.setAttribute("d", outline.toSVGPath());

    const deleteButton = document.createElement("button");
    div.append(deleteButton);
    deleteButton.classList.add("toolbarButton", "deleteButton");
    deleteButton.setAttribute(
      "data-l10n-id",
      "pdfjs-editor-delete-signature-button"
    );
    deleteButton.type = "button";
    deleteButton.tabIndex = 0;
    deleteButton.addEventListener("click", async () => {
      if (await this.#signatureStorage.delete(uuid)) {
        div.remove();
      }
    });
    const deleteSpan = document.createElement("span");
    deleteButton.append(deleteSpan);
    deleteSpan.setAttribute(
      "data-l10n-id",
      "pdfjs-editor-delete-signature-button-label"
    );

    this.#addSignatureToolbarButton.before(div);
  }

  async #signaturesChanged() {
    const parent = this.#addSignatureToolbarButton.parentElement;
    while (parent.firstElementChild !== this.#addSignatureToolbarButton) {
      parent.firstElementChild.remove();
    }
    this.#loadSignaturesPromise = null;
    await this.loadSignatures(/* reload = */ true);
  }

  getSignature(params) {
    return this.open(params);
  }

  async loadSignatures(reload = false) {
    if (
      !this.#addSignatureToolbarButton ||
      (!reload && this.#addSignatureToolbarButton.previousElementSibling) ||
      !this.#signatureStorage
    ) {
      return;
    }

    if (!this.#loadSignaturesPromise) {
      // The first call of loadSignatures() starts loading the signatures.
      // The second one will wait until the signatures are loaded in the DOM.
      this.#loadSignaturesPromise = this.#signatureStorage
        .getAll()
        .then(async signatures => [
          signatures,
          await Promise.all(
            Array.from(signatures.values(), ({ signatureData }) =>
              SignatureExtractor.decompressSignature(signatureData)
            )
          ),
        ]);
      if (!reload) {
        return;
      }
    }
    const [signatures, signaturesData] = await this.#loadSignaturesPromise;
    this.#loadSignaturesPromise = null;

    let i = 0;
    for (const [uuid, { description }] of signatures) {
      const data = signaturesData[i++];
      if (!data) {
        continue;
      }
      data.curves = data.outlines.map(points => ({ points }));
      delete data.outlines;
      this.#addToolbarButton(data, uuid, description);
    }
  }

  async renderEditButton(editor) {
    const button = document.createElement("button");
    button.classList.add("altText", "editDescription");
    button.tabIndex = 0;
    button.title = editor.description;
    const span = document.createElement("span");
    button.append(span);
    span.setAttribute(
      "data-l10n-id",
      "pdfjs-editor-add-signature-edit-button-label"
    );
    button.addEventListener(
      "click",
      () => {
        this.#editDescriptionDialog.open(editor);
      },
      { passive: true }
    );
    return button;
  }

  async open({ uiManager, editor }) {
    this.#tabsToAltText ||= new Map(
      this.#tabButtons.keys().map(name => [name, ""])
    );
    this.#uiManager = uiManager;
    this.#currentEditor = editor;
    this.#uiManager.removeEditListeners();

    const isStorageFull = await this.#signatureStorage.isFull();
    this.#saveContainer.classList.toggle("fullStorage", isStorageFull);
    this.#saveCheckbox.checked = !isStorageFull;

    await this.#overlayManager.open(this.#dialog);

    const tabType = this.#tabButtons.get("type");
    tabType.focus();
    tabType.click();
  }

  #cancel() {
    this.#finish();
  }

  #finish() {
    if (this.#overlayManager.active === this.#dialog) {
      this.#overlayManager.close(this.#dialog);
    }
  }

  #close() {
    if (this.#currentEditor._drawId === null) {
      this.#currentEditor.remove();
    }
    this.#uiManager?.addEditListeners();
    this.#currentTabAC?.abort();
    this.#currentTabAC = null;
    this.#uiManager = null;
    this.#currentEditor = null;

    this.#resetCommon();
    for (const [name] of this.#tabButtons) {
      this.#resetTab(name);
    }
    this.#disableButtons(false);
    this.#currentTab = null;
    this.#tabsToAltText = null;
  }

  async #add() {
    let data;
    switch (this.#currentTab) {
      case "type":
        data = this.#getOutlineForType();
        break;
      case "draw":
        data = this.#getOutlineForDraw();
        break;
      case "image":
        data = this.#extractedSignatureData;
        break;
    }
    let uuid = null;
    if (this.#saveCheckbox.checked) {
      const description = this.#description.value;
      const { newCurves, areContours, thickness, width, height } = data;
      const signatureData = await SignatureExtractor.compressSignature({
        outlines: newCurves,
        areContours,
        thickness,
        width,
        height,
      });
      uuid = await this.#signatureStorage.create({
        description,
        signatureData,
      });
      if (uuid) {
        this.#addToolbarButton(
          {
            curves: newCurves.map(points => ({ points })),
            areContours,
            thickness,
            width,
            height,
          },
          uuid,
          description
        );
      } else {
        console.warn("SignatureManager.add: cannot save the signature.");
      }
    }
    this.#currentEditor.addSignature(
      data,
      DEFAULT_HEIGHT_IN_PAGE,
      this.#description.value,
      uuid
    );

    this.#finish();
  }

  destroy() {
    this.#uiManager = null;
    this.#finish();
  }
}

class EditDescriptionDialog {
  #currentEditor;

  #previousDescription;

  #description;

  #dialog;

  #overlayManager;

  #signatureSVG;

  #uiManager;

  constructor(
    { dialog, description, cancelButton, updateButton, editSignatureView },
    overlayManager
  ) {
    const descriptionInput = (this.#description =
      description.firstElementChild);
    this.#signatureSVG = editSignatureView;
    this.#dialog = dialog;
    this.#overlayManager = overlayManager;

    dialog.addEventListener("close", this.#close.bind(this));
    dialog.addEventListener("contextmenu", e => {
      if (e.target !== this.#description) {
        e.preventDefault();
      }
    });
    cancelButton.addEventListener("click", this.#finish.bind(this));
    updateButton.addEventListener("click", this.#update.bind(this));

    const clearDescription = description.lastElementChild;
    clearDescription.addEventListener("click", () => {
      descriptionInput.value = "";
      clearDescription.disabled = true;
    });
    descriptionInput.addEventListener(
      "input",
      () => {
        const { value } = descriptionInput;
        clearDescription.disabled = value === "";
        updateButton.disabled = value === this.#previousDescription;
        editSignatureView.setAttribute("aria-label", value);
      },
      { passive: true }
    );

    overlayManager.register(dialog);
  }

  async open(editor) {
    this.#uiManager = editor._uiManager;
    this.#currentEditor = editor;
    this.#previousDescription = this.#description.value = editor.description;
    this.#description.dispatchEvent(new Event("input"));
    this.#uiManager.removeEditListeners();
    const { areContours, outline } = editor.getSignaturePreview();
    const svgFactory = new DOMSVGFactory();
    const path = svgFactory.createElement("path");
    this.#signatureSVG.append(path);
    this.#signatureSVG.setAttribute("viewBox", outline.viewBox);
    path.setAttribute("d", outline.toSVGPath());
    if (areContours) {
      path.classList.add("contours");
    }

    await this.#overlayManager.open(this.#dialog);
  }

  async #update() {
    const description = this.#description.value;
    if (this.#previousDescription === description) {
      this.#finish();
      return;
    }
    this.#currentEditor.description = description;
    this.#finish();
  }

  #finish() {
    if (this.#overlayManager.active === this.#dialog) {
      this.#overlayManager.close(this.#dialog);
    }
  }

  #close() {
    this.#uiManager?.addEditListeners();
    this.#uiManager = null;
    this.#currentEditor = null;
    this.#signatureSVG.firstElementChild.remove();
  }
}

export { SignatureManager };
