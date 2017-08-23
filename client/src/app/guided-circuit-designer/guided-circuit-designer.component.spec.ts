import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { GuidedCircuitDesignerComponent } from './guided-circuit-designer.component';

describe('GuidedCircuitDesignerComponent', () => {
  let component: GuidedCircuitDesignerComponent;
  let fixture: ComponentFixture<GuidedCircuitDesignerComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ GuidedCircuitDesignerComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(GuidedCircuitDesignerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should be created', () => {
    expect(component).toBeTruthy();
  });
});
