import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { StaticCircuitDesignerComponent } from './static-circuit-designer.component';

describe('StaticCircuitDesignerComponent', () => {
  let component: StaticCircuitDesignerComponent;
  let fixture: ComponentFixture<StaticCircuitDesignerComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ StaticCircuitDesignerComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(StaticCircuitDesignerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should be created', () => {
    expect(component).toBeTruthy();
  });
});
