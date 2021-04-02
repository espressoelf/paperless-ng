import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
import { cloneFilterRules, FilterRule } from '../data/filter-rule';
import { PaperlessDocument } from '../data/paperless-document';
import { PaperlessSavedView } from '../data/paperless-saved-view';
import { DOCUMENT_LIST_SERVICE } from '../data/storage-keys';
import { DocumentService } from './rest/document.service';
import { SettingsService, SETTINGS_KEYS } from './settings.service';

interface ListViewState {

  title?: string

  documents?: PaperlessDocument[]

  currentPage: number
  collectionSize: number

  sortField: string
  sortReverse: boolean

  filterRules: FilterRule[]

  selected?: Set<number>

}

/**
 * This service manages the document list which is displayed using the document list view.
 *
 * This service also serves saved views by transparently switching between the document list
 * and saved views on request. See below.
 */
@Injectable({
  providedIn: 'root'
})
export class DocumentListViewService {

  isReloading: boolean = false

  rangeSelectionAnchorIndex: number
  lastRangeSelectionToIndex: number

  currentPageSize: number = this.settings.get(SETTINGS_KEYS.DOCUMENT_LIST_SIZE)

  private listViewStates: Map<number, ListViewState> = new Map()

  private _activeSavedViewId: number = null

  get activeSavedViewId() {
    return this._activeSavedViewId
  }

  get activeSavedViewTitle() {
    return this.activeListViewState.title
  }

  private defaultListViewState(): ListViewState {
    return {
      title: null,
      documents: [],
      currentPage: 1,
      collectionSize: null,
      sortField: "created",
      sortReverse: true,
      filterRules: [],
      selected: new Set<number>()
    }
  }

  private get activeListViewState() {
    if (!this.listViewStates.has(this._activeSavedViewId)) {
      this.listViewStates.set(this._activeSavedViewId, this.defaultListViewState())
    }
    return this.listViewStates.get(this._activeSavedViewId)
  }

  activateSavedView(view: PaperlessSavedView) {
    this.rangeSelectionAnchorIndex = this.lastRangeSelectionToIndex = null
    if (view) {
      this._activeSavedViewId = view.id
      this.loadSavedView(view)
    } else {
      this._activeSavedViewId = null
    }
  }

  loadSavedView(view: PaperlessSavedView, closeCurrentView: boolean = false) {
    if (closeCurrentView) {
      this._activeSavedViewId = null
    }
    this.activeListViewState.filterRules = cloneFilterRules(view.filter_rules)
    this.activeListViewState.sortField = view.sort_field
    this.activeListViewState.sortReverse = view.sort_reverse
    if (this._activeSavedViewId) {
      this.activeListViewState.title = view.name
    }
    this.reduceSelectionToFilter()
  }

  reload(onFinish?) {
    this.isReloading = true
    let activeListViewState = this.activeListViewState

    this.documentService.listFiltered(
      activeListViewState.currentPage,
      this.currentPageSize,
      activeListViewState.sortField,
      activeListViewState.sortReverse,
      activeListViewState.filterRules).subscribe(
        result => {
          this.isReloading = false
          activeListViewState.collectionSize = result.count
          activeListViewState.documents = result.results
          if (onFinish) {
            onFinish()
          }
          this.rangeSelectionAnchorIndex = this.lastRangeSelectionToIndex = null
        },
        error => {
          this.isReloading = false
          if (activeListViewState.currentPage != 1 && error.status == 404) {
            // this happens when applying a filter: the current page might not be available anymore due to the reduced result set.
            activeListViewState.currentPage = 1
            this.reload()
          }
        })
  }

  set filterRules(filterRules: FilterRule[]) {
    this.activeListViewState.filterRules = filterRules
    this.reload()
    this.reduceSelectionToFilter()
    this.saveDocumentListView()
  }

  get filterRules(): FilterRule[] {
    return this.activeListViewState.filterRules
  }

  set sortField(field: string) {
    this.activeListViewState.sortField = field
    this.reload()
    this.saveDocumentListView()
  }

  get sortField(): string {
    return this.activeListViewState.sortField
  }

  set sortReverse(reverse: boolean) {
    this.activeListViewState.sortReverse = reverse
    this.reload()
    this.saveDocumentListView()
  }

  get sortReverse(): boolean {
    return this.activeListViewState.sortReverse
  }

  get collectionSize(): number {
    return this.activeListViewState.collectionSize
  }

  get currentPage(): number {
    return this.activeListViewState.currentPage
  }

  set currentPage(page: number) {
    this.activeListViewState.currentPage = page
    this.reload()
    this.saveDocumentListView()
  }

  get documents(): PaperlessDocument[] {
    return this.activeListViewState.documents
  }

  get selected(): Set<number> {
    return this.activeListViewState.selected
  }

  get selectedDocuments(): PaperlessDocument[] {
    return this.activeListViewState.documents.filter(d => this.activeListViewState.selected.has(d.id))
  }

  setSort(field: string, reverse: boolean) {
    this.activeListViewState.sortField = field
    this.activeListViewState.sortReverse = reverse
    this.reload()
    this.saveDocumentListView()
  }

  private saveDocumentListView() {
    if (this._activeSavedViewId == null) {
      let savedState: ListViewState = {
        collectionSize: this.activeListViewState.collectionSize,
        currentPage: this.activeListViewState.currentPage,
        filterRules: this.activeListViewState.filterRules,
        sortField: this.activeListViewState.sortField,
        sortReverse: this.activeListViewState.sortReverse
      }
      localStorage.setItem(DOCUMENT_LIST_SERVICE.CURRENT_VIEW_CONFIG, JSON.stringify(savedState))
    }
  }

  quickFilter(filterRules: FilterRule[]) {
    this._activeSavedViewId = null
    this.activeListViewState.filterRules = filterRules
    this.activeListViewState.currentPage = 1
    this.reduceSelectionToFilter()
    this.saveDocumentListView()
    this.router.navigate(["documents"])
  }

  getLastPage(): number {
    return Math.ceil(this.collectionSize / this.currentPageSize)
  }

  hasNext(doc: number) {
    if (this.documents) {
      let index = this.documents.findIndex(d => d.id == doc)
      return index != -1 && (this.currentPage < this.getLastPage() || (index + 1) < this.documents.length)
    }
  }

  getNext(currentDocId: number): Observable<number> {
    return new Observable(nextDocId => {
      if (this.documents != null) {

        let index = this.documents.findIndex(d => d.id == currentDocId)

        if (index != -1 && (index + 1) < this.documents.length) {
          nextDocId.next(this.documents[index+1].id)
          nextDocId.complete()
        } else if (index != -1 && this.currentPage < this.getLastPage()) {
          this.currentPage += 1
          this.reload(() => {
            nextDocId.next(this.documents[0].id)
            nextDocId.complete()
          })
        } else {
          nextDocId.complete()
        }
      } else {
        nextDocId.complete()
      }
    })
  }

  updatePageSize() {
    let newPageSize = this.settings.get(SETTINGS_KEYS.DOCUMENT_LIST_SIZE)
    if (newPageSize != this.currentPageSize) {
      this.currentPageSize = newPageSize
    }
  }

  selectNone() {
    this.selected.clear()
    this.rangeSelectionAnchorIndex = this.lastRangeSelectionToIndex = null
  }

  reduceSelectionToFilter() {
    if (this.selected.size > 0) {
      this.documentService.listAllFilteredIds(this.filterRules).subscribe(ids => {
        for (let id of this.selected) {
          if (!ids.includes(id)) {
            this.selected.delete(id)
          }
        }
      })
    }
  }

  selectAll() {
    this.documentService.listAllFilteredIds(this.filterRules).subscribe(ids => ids.forEach(id => this.selected.add(id)))
  }

  selectPage() {
    this.selected.clear()
    this.documents.forEach(doc => {
      this.selected.add(doc.id)
    })
  }

  isSelected(d: PaperlessDocument) {
    return this.selected.has(d.id)
  }

  toggleSelected(d: PaperlessDocument): void {
    if (this.selected.has(d.id)) this.selected.delete(d.id)
    else this.selected.add(d.id)
    this.rangeSelectionAnchorIndex = this.documentIndexInCurrentView(d.id)
    this.lastRangeSelectionToIndex = null
  }

  selectRangeTo(d: PaperlessDocument) {
    if (this.rangeSelectionAnchorIndex !== null) {
      const documentToIndex = this.documentIndexInCurrentView(d.id)
      const fromIndex = Math.min(this.rangeSelectionAnchorIndex, documentToIndex)
      const toIndex = Math.max(this.rangeSelectionAnchorIndex, documentToIndex)

      if (this.lastRangeSelectionToIndex !== null) {
        // revert the old selection
        this.documents.slice(Math.min(this.rangeSelectionAnchorIndex, this.lastRangeSelectionToIndex), Math.max(this.rangeSelectionAnchorIndex, this.lastRangeSelectionToIndex) + 1).forEach(d => {
          this.selected.delete(d.id)
        })
      }

      this.documents.slice(fromIndex, toIndex + 1).forEach(d => {
        this.selected.add(d.id)
      })
      this.lastRangeSelectionToIndex = documentToIndex
    } else { // e.g. shift key but was first click
      this.toggleSelected(d)
    }
  }

  documentIndexInCurrentView(documentID: number): number {
    return this.documents.map(d => d.id).indexOf(documentID)
  }

  constructor(private documentService: DocumentService, private settings: SettingsService, private router: Router) {
     let documentListViewConfigJson = localStorage.getItem(DOCUMENT_LIST_SERVICE.CURRENT_VIEW_CONFIG)
    if (documentListViewConfigJson) {
      try {
        let savedState: ListViewState = JSON.parse(documentListViewConfigJson)
        // Remove null elements from the restored state
        Object.keys(savedState).forEach(k => {
          if (savedState[k] == null) {
            delete savedState[k]
          }
        })
        //only use restored state attributes instead of defaults if they are not null
        let newState = Object.assign(this.defaultListViewState(), savedState)
        this.listViewStates.set(null, newState)
      } catch (e) {
        localStorage.removeItem(DOCUMENT_LIST_SERVICE.CURRENT_VIEW_CONFIG)
      }
    }
  }
}
