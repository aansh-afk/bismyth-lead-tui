use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use unicode_width::UnicodeWidthChar;

type Position = (usize, usize);
type Wrapped = (Vec<String>, Position, Vec<Position>);

#[derive(Clone, Default)]
pub struct Editor {
    pub value: Vec<char>,
    pub cursor: usize,
}
impl Editor {
    pub fn new(value: &str) -> Self {
        let value: Vec<char> = value
            .chars()
            .filter(|c| !c.is_control() || *c == '\n')
            .collect();
        let cursor = value.len();
        Self { value, cursor }
    }
    pub fn text(&self) -> String {
        self.value.iter().collect()
    }
    pub fn insert(&mut self, text: &str) {
        let chars: Vec<char> = text
            .chars()
            .filter(|c| !c.is_control() || *c == '\n')
            .collect();
        let count = chars.len();
        self.value.splice(self.cursor..self.cursor, chars);
        self.cursor += count;
    }
    pub fn key(&mut self, key: KeyEvent, multiline: bool) {
        if key.modifiers.contains(KeyModifiers::CONTROL) {
            match key.code {
                KeyCode::Char('u') => {
                    self.value.clear();
                    self.cursor = 0;
                }
                KeyCode::Char('a') => self.cursor = 0,
                KeyCode::Char('e') => self.cursor = self.value.len(),
                _ => {}
            }
            return;
        }
        match key.code {
            KeyCode::Char(c) => self.insert(&c.to_string()),
            KeyCode::Enter if multiline => self.insert("\n"),
            KeyCode::Backspace if self.cursor > 0 => {
                self.cursor -= 1;
                self.value.remove(self.cursor);
            }
            KeyCode::Delete if self.cursor < self.value.len() => {
                self.value.remove(self.cursor);
            }
            KeyCode::Left => self.cursor = self.cursor.saturating_sub(1),
            KeyCode::Right => self.cursor = (self.cursor + 1).min(self.value.len()),
            KeyCode::Home => {
                self.cursor = self.value[..self.cursor]
                    .iter()
                    .rposition(|c| *c == '\n')
                    .map(|x| x + 1)
                    .unwrap_or(0)
            }
            KeyCode::End => {
                self.cursor = self.value[self.cursor..]
                    .iter()
                    .position(|c| *c == '\n')
                    .map(|x| x + self.cursor)
                    .unwrap_or(self.value.len())
            }
            _ => {}
        }
    }
    pub fn wrapped(&self, width: usize) -> Wrapped {
        let width = width.max(1);
        let mut lines = vec![String::new()];
        let (mut row, mut col) = (0, 0);
        let mut positions = Vec::new();
        for c in &self.value {
            if *c != '\n' {
                let size = c.width().unwrap_or(0);
                if col + size > width {
                    row += 1;
                    col = 0;
                    lines.push(String::new());
                }
            }
            positions.push((row, col));
            if *c == '\n' {
                row += 1;
                col = 0;
                lines.push(String::new());
            } else {
                lines[row].push(*c);
                col += c.width().unwrap_or(0);
            }
        }
        if col >= width {
            row += 1;
            col = 0;
            lines.push(String::new());
        }
        positions.push((row, col));
        let cursor = positions[self.cursor.min(positions.len() - 1)];
        (lines, cursor, positions)
    }
    pub fn vertical(&mut self, up: bool, width: usize) {
        let (_, cursor, positions) = self.wrapped(width);
        let target = if up {
            cursor.0.saturating_sub(1)
        } else {
            cursor.0 + 1
        };
        if let Some((i, _)) = positions
            .iter()
            .enumerate()
            .filter(|(_, p)| p.0 == target)
            .min_by_key(|(_, p)| p.1.abs_diff(cursor.1))
        {
            self.cursor = i;
        }
    }
    pub fn click(&mut self, row: usize, col: usize, width: usize, offset: usize) {
        let (_, _, positions) = self.wrapped(width);
        let target = row + offset;
        self.cursor = positions
            .iter()
            .enumerate()
            .min_by_key(|(_, p)| p.0.abs_diff(target) * width + p.1.abs_diff(col))
            .map(|(i, _)| i)
            .unwrap_or(0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mouse_caret_respects_wide_characters_and_wrapping() {
        let mut editor = Editor::new("ab界cd");
        editor.click(1, 0, 4, 0);
        editor.insert("X");
        assert_eq!(editor.text(), "ab界Xcd");
    }
    #[test]
    fn vertical_editing_and_paste_keep_newlines_without_control_sequences() {
        let mut editor = Editor::new("ab\ncd");
        editor.vertical(true, 20);
        editor.insert("!\u{7}");
        assert_eq!(editor.text(), "ab!\ncd");
        editor.click(0, 1, 20, 1);
        editor.insert("界");
        assert_eq!(editor.text(), "ab!\nc界d");
    }
}
