export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      api_tokens: {
        Row: {
          created_at: string
          device_model: string
          id: string
          kind: string
          label: string
          last_used_at: string | null
          rate_count: number
          rate_window_at: string | null
          token_hash: string
          token_hint: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_model?: string
          id?: string
          kind?: string
          label?: string
          last_used_at?: string | null
          rate_count?: number
          rate_window_at?: string | null
          token_hash: string
          token_hint: string
          user_id?: string
        }
        Update: {
          created_at?: string
          device_model?: string
          id?: string
          kind?: string
          label?: string
          last_used_at?: string | null
          rate_count?: number
          rate_window_at?: string | null
          token_hash?: string
          token_hint?: string
          user_id?: string
        }
        Relationships: []
      }
      book_chapters: {
        Row: {
          book_id: string
          candidates: Json | null
          error: string | null
          spine: number
          status: string
          title: string
          updated_at: string
          words: number
        }
        Insert: {
          book_id: string
          candidates?: Json | null
          error?: string | null
          spine: number
          status?: string
          title?: string
          updated_at?: string
          words?: number
        }
        Update: {
          book_id?: string
          candidates?: Json | null
          error?: string | null
          spine?: number
          status?: string
          title?: string
          updated_at?: string
          words?: number
        }
        Relationships: [
          {
            foreignKeyName: "book_chapters_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
        ]
      }
      book_progress: {
        Row: {
          at: string
          book_id: string
          chapter_percent: number
          percent: number
          source: string
          spine: number
          user_id: string
        }
        Insert: {
          at: string
          book_id: string
          chapter_percent?: number
          percent?: number
          source: string
          spine: number
          user_id: string
        }
        Update: {
          at?: string
          book_id?: string
          chapter_percent?: number
          percent?: number
          source?: string
          spine?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "book_progress_book_id_user_id_fkey"
            columns: ["book_id", "user_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      book_signing: {
        Row: {
          path: string
          until: string
        }
        Insert: {
          path: string
          until: string
        }
        Update: {
          path?: string
          until?: string
        }
        Relationships: []
      }
      book_versions: {
        Row: {
          book_id: string
          created_at: string
          ko_hash: string
          path: string
          size: number
          user_id: string
          version: number
        }
        Insert: {
          book_id: string
          created_at?: string
          ko_hash: string
          path: string
          size: number
          user_id: string
          version: number
        }
        Update: {
          book_id?: string
          created_at?: string
          ko_hash?: string
          path?: string
          size?: number
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "book_versions_book_id_user_id_fkey"
            columns: ["book_id", "user_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      books: {
        Row: {
          author: string
          book_language: string
          coverage: number
          created_at: string
          current_version: number | null
          id: string
          language: string
          on_device: boolean
          original_path: string
          original_size: number
          range_from: number
          range_to: number
          title: string
          updated_at: string
          user_id: string
          work_id: string | null
        }
        Insert: {
          author?: string
          book_language: string
          coverage?: number
          created_at?: string
          current_version?: number | null
          id?: string
          language: string
          on_device?: boolean
          original_path: string
          original_size: number
          range_from?: number
          range_to?: number
          title: string
          updated_at?: string
          user_id: string
          work_id?: string | null
        }
        Update: {
          author?: string
          book_language?: string
          coverage?: number
          created_at?: string
          current_version?: number | null
          id?: string
          language?: string
          on_device?: boolean
          original_path?: string
          original_size?: number
          range_from?: number
          range_to?: number
          title?: string
          updated_at?: string
          user_id?: string
          work_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "books_work_id_user_id_fkey"
            columns: ["work_id", "user_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      decks: {
        Row: {
          created_at: string
          id: string
          import_hash: string | null
          is_default: boolean
          language: string
          limits_day: string | null
          name: string
          new_order: string
          new_per_day: number | null
          new_today: number | null
          on_reader: boolean
          parent_id: string | null
          paused: boolean
          position: number
          reviews_per_day: number | null
          reviews_today: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          import_hash?: string | null
          is_default?: boolean
          language: string
          limits_day?: string | null
          name: string
          new_order?: string
          new_per_day?: number | null
          new_today?: number | null
          on_reader?: boolean
          parent_id?: string | null
          paused?: boolean
          position?: number
          reviews_per_day?: number | null
          reviews_today?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          import_hash?: string | null
          is_default?: boolean
          language?: string
          limits_day?: string | null
          name?: string
          new_order?: string
          new_per_day?: number | null
          new_today?: number | null
          on_reader?: boolean
          parent_id?: string | null
          paused?: boolean
          position?: number
          reviews_per_day?: number | null
          reviews_today?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "decks_parent_id_user_id_fkey"
            columns: ["parent_id", "user_id"]
            isOneToOne: false
            referencedRelation: "decks"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      device_pairings: {
        Row: {
          client_ip_hash: string | null
          created_at: string
          decided_at: string | null
          device_code_hash: string
          device_model: string
          device_name: string
          expires_at: string
          firmware: string
          id: string
          last_poll_at: string | null
          poll_interval: number
          status: string
          token_id: string | null
          user_code: string
          user_id: string | null
        }
        Insert: {
          client_ip_hash?: string | null
          created_at?: string
          decided_at?: string | null
          device_code_hash: string
          device_model?: string
          device_name: string
          expires_at: string
          firmware?: string
          id?: string
          last_poll_at?: string | null
          poll_interval?: number
          status?: string
          token_id?: string | null
          user_code: string
          user_id?: string | null
        }
        Update: {
          client_ip_hash?: string | null
          created_at?: string
          decided_at?: string | null
          device_code_hash?: string
          device_model?: string
          device_name?: string
          expires_at?: string
          firmware?: string
          id?: string
          last_poll_at?: string | null
          poll_interval?: number
          status?: string
          token_id?: string | null
          user_code?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "device_pairings_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "api_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      encounters: {
        Row: {
          client_id: string | null
          created_at: string
          deleted_at: string | null
          form: string
          highlight: string
          id: string
          item_id: string
          origin: string
          position: Json
          seen_at: string
          sense: string
          sentence: string
          translation: string
          user_id: string
          work_id: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          deleted_at?: string | null
          form?: string
          highlight?: string
          id?: string
          item_id: string
          origin: string
          position?: Json
          seen_at?: string
          sense?: string
          sentence?: string
          translation?: string
          user_id: string
          work_id?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string
          deleted_at?: string | null
          form?: string
          highlight?: string
          id?: string
          item_id?: string
          origin?: string
          position?: Json
          seen_at?: string
          sense?: string
          sentence?: string
          translation?: string
          user_id?: string
          work_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "encounters_item_id_user_id_fkey"
            columns: ["item_id", "user_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "encounters_work_id_user_id_fkey"
            columns: ["work_id", "user_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      extra_new: {
        Row: {
          day: string
          language: string
          n: number
          user_id: string
        }
        Insert: {
          day: string
          language: string
          n: number
          user_id: string
        }
        Update: {
          day?: string
          language?: string
          n?: number
          user_id?: string
        }
        Relationships: []
      }
      fichas: {
        Row: {
          anki_guid: string | null
          back: string
          back_audio: string | null
          back_image: string | null
          cloze_count: number
          created_at: string
          deck_id: string
          deleted_at: string | null
          front: string
          front_audio: string | null
          front_image: string | null
          id: string
          language: string
          leech_hold: string | null
          leech_hold_at: string | null
          reverse: boolean
          status: string
          tags: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          anki_guid?: string | null
          back?: string
          back_audio?: string | null
          back_image?: string | null
          cloze_count?: number
          created_at?: string
          deck_id: string
          deleted_at?: string | null
          front: string
          front_audio?: string | null
          front_image?: string | null
          id?: string
          language: string
          leech_hold?: string | null
          leech_hold_at?: string | null
          reverse?: boolean
          status?: string
          tags?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          anki_guid?: string | null
          back?: string
          back_audio?: string | null
          back_image?: string | null
          cloze_count?: number
          created_at?: string
          deck_id?: string
          deleted_at?: string | null
          front?: string
          front_audio?: string | null
          front_image?: string | null
          id?: string
          language?: string
          leech_hold?: string | null
          leech_hold_at?: string | null
          reverse?: boolean
          status?: string
          tags?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fichas_deck_id_user_id_fkey"
            columns: ["deck_id", "user_id"]
            isOneToOne: false
            referencedRelation: "decks"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      flashcards: {
        Row: {
          created_at: string
          difficulty: number
          due_at: string
          ficha_id: string | null
          id: string
          item_id: string | null
          kind: string
          lapses: number
          last_review_at: string | null
          learning_step: number
          ord: number
          reps: number
          schedule_status: string
          scheduled_days: number
          stability: number
          stability_fast: number
          state: number
          user_id: string
        }
        Insert: {
          created_at?: string
          difficulty?: number
          due_at?: string
          ficha_id?: string | null
          id?: string
          item_id?: string | null
          kind: string
          lapses?: number
          last_review_at?: string | null
          learning_step?: number
          ord?: number
          reps?: number
          schedule_status?: string
          scheduled_days?: number
          stability?: number
          stability_fast?: number
          state?: number
          user_id: string
        }
        Update: {
          created_at?: string
          difficulty?: number
          due_at?: string
          ficha_id?: string | null
          id?: string
          item_id?: string | null
          kind?: string
          lapses?: number
          last_review_at?: string | null
          learning_step?: number
          ord?: number
          reps?: number
          schedule_status?: string
          scheduled_days?: number
          stability?: number
          stability_fast?: number
          state?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flashcards_ficha_id_user_id_fkey"
            columns: ["ficha_id", "user_id"]
            isOneToOne: false
            referencedRelation: "fichas"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "flashcards_item_id_user_id_fkey"
            columns: ["item_id", "user_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      items: {
        Row: {
          audio: string | null
          created_at: string
          deck_id: string
          deleted_at: string | null
          id: string
          image: string | null
          ipa: string
          language: string
          last_seen_at: string | null
          leech_hold: string | null
          leech_hold_at: string | null
          lemma: string
          lemma_key: string
          note: string
          part_of_speech: string
          reading: string
          seen_count: number
          sense: string
          status: string
          tags: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          audio?: string | null
          created_at?: string
          deck_id: string
          deleted_at?: string | null
          id?: string
          image?: string | null
          ipa?: string
          language: string
          last_seen_at?: string | null
          leech_hold?: string | null
          leech_hold_at?: string | null
          lemma: string
          lemma_key: string
          note?: string
          part_of_speech?: string
          reading?: string
          seen_count?: number
          sense?: string
          status?: string
          tags?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          audio?: string | null
          created_at?: string
          deck_id?: string
          deleted_at?: string | null
          id?: string
          image?: string | null
          ipa?: string
          language?: string
          last_seen_at?: string | null
          leech_hold?: string | null
          leech_hold_at?: string | null
          lemma?: string
          lemma_key?: string
          note?: string
          part_of_speech?: string
          reading?: string
          seen_count?: number
          sense?: string
          status?: string
          tags?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "items_deck_id_user_id_fkey"
            columns: ["deck_id", "user_id"]
            isOneToOne: false
            referencedRelation: "decks"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      review_logs: {
        Row: {
          algo_version: string | null
          client_id: string | null
          desired_retention: number | null
          difficulty_before: number | null
          duration_ms: number | null
          flashcard_id: string
          id: string
          interval_days: number | null
          last_interval_days: number | null
          rating: number
          received_at: string
          reviewed_at: string
          stability_before: number | null
          stability_fast_before: number | null
          state_before: number | null
          user_id: string
        }
        Insert: {
          algo_version?: string | null
          client_id?: string | null
          desired_retention?: number | null
          difficulty_before?: number | null
          duration_ms?: number | null
          flashcard_id: string
          id?: string
          interval_days?: number | null
          last_interval_days?: number | null
          rating: number
          received_at?: string
          reviewed_at: string
          stability_before?: number | null
          stability_fast_before?: number | null
          state_before?: number | null
          user_id: string
        }
        Update: {
          algo_version?: string | null
          client_id?: string | null
          desired_retention?: number | null
          difficulty_before?: number | null
          duration_ms?: number | null
          flashcard_id?: string
          id?: string
          interval_days?: number | null
          last_interval_days?: number | null
          rating?: number
          received_at?: string
          reviewed_at?: string
          stability_before?: number | null
          stability_fast_before?: number | null
          state_before?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_logs_flashcard_id_user_id_fkey"
            columns: ["flashcard_id", "user_id"]
            isOneToOne: false
            referencedRelation: "flashcards"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      review_logs_undone: {
        Row: {
          algo_version: string | null
          client_id: string | null
          desired_retention: number | null
          difficulty_before: number | null
          duration_ms: number | null
          flashcard_id: string
          id: string
          interval_days: number | null
          last_interval_days: number | null
          rating: number
          received_at: string
          reviewed_at: string
          stability_before: number | null
          stability_fast_before: number | null
          state_before: number | null
          undone_at: string
          user_id: string
        }
        Insert: {
          algo_version?: string | null
          client_id?: string | null
          desired_retention?: number | null
          difficulty_before?: number | null
          duration_ms?: number | null
          flashcard_id: string
          id?: string
          interval_days?: number | null
          last_interval_days?: number | null
          rating: number
          received_at?: string
          reviewed_at: string
          stability_before?: number | null
          stability_fast_before?: number | null
          state_before?: number | null
          undone_at?: string
          user_id: string
        }
        Update: {
          algo_version?: string | null
          client_id?: string | null
          desired_retention?: number | null
          difficulty_before?: number | null
          duration_ms?: number | null
          flashcard_id?: string
          id?: string
          interval_days?: number | null
          last_interval_days?: number | null
          rating?: number
          received_at?: string
          reviewed_at?: string
          stability_before?: number | null
          stability_fast_before?: number | null
          state_before?: number | null
          undone_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_logs_undone_flashcard_id_user_id_fkey"
            columns: ["flashcard_id", "user_id"]
            isOneToOne: false
            referencedRelation: "flashcards"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      sync_ops: {
        Row: {
          client_id: string
          received_at: string
          result: Json
          type: string
          user_id: string
        }
        Insert: {
          client_id: string
          received_at?: string
          result?: Json
          type: string
          user_id: string
        }
        Update: {
          client_id?: string
          received_at?: string
          result?: Json
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          autoplay_audio: boolean
          day_start_hour: number
          desired_retention: number
          leech_action: string
          leech_lapses: number
          native_language: string | null
          new_flashcards_per_day: number
          new_order: string
          reviews_per_day: number
          study_languages: unknown[]
          time_zone: string | null
          ui_language: string
          updated_at: string
          user_id: string
        }
        Insert: {
          autoplay_audio?: boolean
          day_start_hour?: number
          desired_retention?: number
          leech_action?: string
          leech_lapses?: number
          native_language?: string | null
          new_flashcards_per_day?: number
          new_order?: string
          reviews_per_day?: number
          study_languages?: unknown[]
          time_zone?: string | null
          ui_language?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          autoplay_audio?: boolean
          day_start_hour?: number
          desired_retention?: number
          leech_action?: string
          leech_lapses?: number
          native_language?: string | null
          new_flashcards_per_day?: number
          new_order?: string
          reviews_per_day?: number
          study_languages?: unknown[]
          time_zone?: string | null
          ui_language?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      works: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          kind: string
          language: string | null
          played_at: string | null
          ref_key: string | null
          refs: Json
          subtitle: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          kind: string
          language?: string | null
          played_at?: string | null
          ref_key?: string | null
          refs?: Json
          subtitle?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          kind?: string
          language?: string | null
          played_at?: string | null
          ref_key?: string | null
          refs?: Json
          subtitle?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_extra_new: {
        Args: { p_day_start: string; p_language: string; p_n: number }
        Returns: number
      }
      add_extra_new_for: {
        Args: {
          p_day: string
          p_language: unknown
          p_n: number
          p_user: string
        }
        Returns: number
      }
      api_items: {
        Args: { p_language: string; p_token: string }
        Returns: {
          flashcards: Json
          forms: string[]
          id: string
          leech_hold: string
          lemma: string
          lemma_key: string
          reading: string
          sense: string
          status: string
        }[]
      }
      api_mark_seen: {
        Args: { p_language: string; p_lemma_keys: string[]; p_token: string }
        Returns: number
      }
      api_me: {
        Args: { p_token: string }
        Returns: {
          email: string
          native_language: string
          study_languages: string[]
          ui_language: string
        }[]
      }
      api_save_items: {
        Args: { p_items: Json; p_token: string }
        Returns: {
          created: boolean
          encounter_id: string
          flashcard_due_at: string
          flashcard_state: number
          item_id: string
          language: string
          lemma: string
          released: boolean
        }[]
      }
      api_sync_begin: { Args: { p_token: string }; Returns: number }
      api_sync_books: { Args: { p_token: string }; Returns: Json }
      api_sync_deck_import: {
        Args: {
          p_client_id: string
          p_hash: string
          p_language: string
          p_name: string
          p_rows: Json
          p_token: string
        }
        Returns: Json
      }
      api_sync_extra_new: {
        Args: {
          p_at: string
          p_client_id: string
          p_language: string
          p_n: number
          p_token: string
        }
        Returns: Json
      }
      api_sync_progress: {
        Args: {
          p_at: string
          p_chapter_percent: number
          p_client_id: string
          p_ko_hash: string
          p_percent: number
          p_spine: number
          p_token: string
        }
        Returns: Json
      }
      api_sync_reject: {
        Args: {
          p_client_id: string
          p_result: Json
          p_token: string
          p_type: string
        }
        Returns: Json
      }
      api_sync_review: {
        Args: {
          p_client_id: string
          p_duration_ms: number
          p_expected_reps: number
          p_flashcard_id: string
          p_next: Json
          p_rating: number
          p_result: Json
          p_reviewed_at: string
          p_token: string
          p_unlock_produce: boolean
        }
        Returns: Json
      }
      api_sync_review_target: {
        Args: {
          p_client_id: string
          p_flashcard_id: string
          p_save_client_id: string
          p_token: string
        }
        Returns: Json
      }
      api_sync_save: {
        Args: {
          p_at: string
          p_client_id: string
          p_entry: Json
          p_token: string
        }
        Returns: Json
      }
      api_sync_seen: {
        Args: {
          p_at: string
          p_client_id: string
          p_language: string
          p_lemma_key: string
          p_token: string
        }
        Returns: Json
      }
      api_sync_snapshot: {
        Args: {
          p_after: string
          p_day_start?: string
          p_kind: string
          p_language: string
          p_limit: number
          p_token: string
        }
        Returns: Json
      }
      api_sync_unpair: { Args: { p_token: string }; Returns: undefined }
      api_token_owner: { Args: { p_token: string }; Returns: string }
      apply_leech: {
        Args: {
          p_card: Database["public"]["Tables"]["flashcards"]["Row"]
          p_lapses: number
          p_user: string
        }
        Returns: undefined
      }
      book_signable: { Args: { p_path: string }; Returns: boolean }
      create_book: {
        Args: {
          p_author: string
          p_book_language: string
          p_chapters: Json
          p_id: string
          p_language: string
          p_original_size: number
          p_title: string
        }
        Returns: string
      }
      deck_for_path: {
        Args: { p_language: unknown; p_path: string; p_user: string }
        Returns: string
      }
      deck_summaries: {
        Args: {
          p_day_start: string
          p_language: string
          p_next_day_start: string
          p_now: string
        }
        Returns: {
          deck_id: string
          fichas: number
          flashcards: number
          items: number
          learning_due: number
          leeches: number
          new_available: number
          new_done_today: number
          review_done_today: number
          review_due: number
        }[]
      }
      default_deck: { Args: { p_language: string }; Returns: string }
      delete_deck: { Args: { p_deck: string; p_mode: string }; Returns: number }
      ensure_default_deck: {
        Args: { p_language: unknown; p_user: string }
        Returns: string
      }
      import_anki_notes: {
        Args: { p_language: string; p_notes: Json }
        Returns: {
          created_at: string
          flashcard_id: string
          fresh: boolean
          guid: string
          kind: string
          ord: number
        }[]
      }
      import_anki_reviews: { Args: { p_flashcards: Json }; Returns: number }
      mark_seen: {
        Args: { p_language: string; p_lemma_key: string }
        Returns: {
          item_id: string
          seen_count: number
        }[]
      }
      media_in_use: { Args: { p_paths: string[] }; Returns: string[] }
      media_quota: { Args: never; Returns: Record<string, unknown> }
      media_quota_bytes: { Args: never; Returns: number }
      media_usage: { Args: never; Returns: number }
      merge_tags: { Args: { p_a: string[]; p_b: string[] }; Returns: string[] }
      new_done_by_deck: {
        Args: { p_day_start: string; p_user: string }
        Returns: {
          deck_id: string
          language: unknown
          n: number
        }[]
      }
      open_album: { Args: { p_album: Json }; Returns: string }
      open_album_track: {
        Args: { p_album: string; p_position: number }
        Returns: string
      }
      open_work: { Args: { p_work: Json }; Returns: string }
      queue_state: {
        Args: { p_day_start: string; p_language: string }
        Returns: Json
      }
      queue_state_for: {
        Args: { p_day_start: string; p_language: unknown; p_user: string }
        Returns: Json
      }
      record_review: {
        Args: {
          p_client_id?: string
          p_duration_ms?: number
          p_expected_reps: number
          p_flashcard_id: string
          p_next: Json
          p_rating: number
          p_reviewed_at: string
          p_unlock_produce: boolean
        }
        Returns: string
      }
      release_leeches: {
        Args: { p_ficha_ids: string[]; p_item_ids: string[] }
        Returns: number
      }
      review_algo_version: { Args: never; Returns: string }
      review_counts: {
        Args: {
          p_day_start: string
          p_language?: string
          p_next_day_start: string
          p_now: string
        }
        Returns: {
          day_key: string
          due_now: number
          extra_new: number
          new_available: number
          new_done_today: number
          new_limit: number
          next_due_at: string
          review_done_today: number
          reviews_limit: number
        }[]
      }
      review_day_key: {
        Args: { p_day_start: string; p_user: string }
        Returns: string
      }
      review_day_start: {
        Args: { p_hour: number; p_now?: string; p_time_zone: string }
        Returns: string
      }
      review_done_by_deck: {
        Args: { p_day_start: string; p_user: string }
        Returns: {
          deck_id: string
          language: unknown
          n: number
        }[]
      }
      save_book_progress: {
        Args: {
          p_at: string
          p_book: string
          p_chapter_percent: number
          p_percent: number
          p_spine: number
        }
        Returns: boolean
      }
      save_items: {
        Args: { p_items: Json }
        Returns: {
          created: boolean
          encounter_id: string
          flashcard_due_at: string
          flashcard_state: number
          item_id: string
          language: string
          lemma: string
          released: boolean
        }[]
      }
      save_items_for: {
        Args: { p_items: Json; p_user: string }
        Returns: {
          created: boolean
          encounter_id: string
          flashcard_due_at: string
          flashcard_state: number
          item_id: string
          language: string
          lemma: string
          released: boolean
        }[]
      }
      set_deck_limits: {
        Args: {
          p_day_start: string
          p_deck: string
          p_new: number
          p_new_mode: string
          p_reviews: number
          p_reviews_mode: string
        }
        Returns: undefined
      }
      set_default_deck: { Args: { p_deck: string }; Returns: undefined }
      set_lyrics_sync: {
        Args: { p_sync: Json; p_work: string }
        Returns: undefined
      }
      sync_claim: {
        Args: { p_client_id: string; p_type: string; p_user: string }
        Returns: Json
      }
      sync_finish: {
        Args: { p_client_id: string; p_result: Json; p_user: string }
        Returns: Json
      }
      sync_pair_decide: {
        Args: { p_approve: boolean; p_user_code: string }
        Returns: string
      }
      sync_pair_lookup: {
        Args: { p_user_code: string }
        Returns: {
          created_at: string
          device_model: string
          device_name: string
          expires_at: string
          firmware: string
        }[]
      }
      sync_pair_poll: {
        Args: {
          p_device_code_hash: string
          p_token_hash: string
          p_token_hint: string
        }
        Returns: {
          account: Json
          device_name: string
          poll_interval: number
          status: string
        }[]
      }
      sync_pair_start: {
        Args: {
          p_device_code_hash: string
          p_device_model: string
          p_device_name: string
          p_enforce_limits?: boolean
          p_firmware: string
          p_ip_hash: string
          p_user_code: string
        }
        Returns: {
          retry_after: number
          status: string
        }[]
      }
      sync_prior: { Args: { p_result: Json }; Returns: Json }
      sync_token_begin: {
        Args: { p_token: string }
        Returns: Record<string, unknown>
      }
      undo_review: {
        Args: {
          p_drop_produce: boolean
          p_expected_reps: number
          p_log_id: string
          p_next: Json
        }
        Returns: string
      }
      valid_book_path: {
        Args: { p_path: string; p_user: string }
        Returns: boolean
      }
      valid_media_path: {
        Args: { p_kind: string; p_path: string; p_user: string }
        Returns: boolean
      }
      valid_tags: { Args: { p_tags: string[] }; Returns: boolean }
      work_for: { Args: { p_user: string; p_work: Json }; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

